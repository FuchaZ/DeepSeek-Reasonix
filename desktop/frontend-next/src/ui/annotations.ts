import { HttpError, type AgentPort } from "../port/port";
import type { PageMark, PickedElement } from "../port/host";

/** One note the person pinned to a page, anchored to the element they picked. */
export interface PageAnnotation {
  id: string;
  pageUrl: string;
  selector: string;
  tagName: string;
  text?: string;
  note: string;
  createdAt: number;
}

/** What the browser panel needs to pin, take back and hand over notes. */
export interface AnnotateCapability {
  annotations: PageAnnotation[];
  /** Reads the store once, so the page's marks can be drawn from it. */
  ensure: () => Promise<void>;
  save: (element: PickedElement, note: string, pageUrl: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  submit: (ann: PageAnnotation) => Promise<void>;
}

const STORE = ".reasonix/annotations.json";

interface Store {
  version: 1;
  annotations: PageAnnotation[];
}

function parse(content: string): Store {
  try {
    const data = JSON.parse(content) as Partial<Store>;
    if (data && data.version === 1 && Array.isArray(data.annotations)) {
      return { version: 1, annotations: data.annotations.filter((one) => one && typeof one.id === "string" && typeof one.pageUrl === "string") };
    }
  } catch {}
  return { version: 1, annotations: [] };
}

async function read(port: AgentPort): Promise<{ store: Store; revision: string } | null> {
  try {
    const file = await port.workspaceFile(STORE);
    return { store: parse(file.content), revision: file.revision };
  } catch (e) {
    if (e instanceof HttpError && e.reason?.code === "workspace.file_missing") return null;
    throw e;
  }
}

// A write refused for the file moving under it is retried once on what the
// change says of a freshly read store, so a lost race costs a re-read, not a
// lost note.
async function mutate(port: AgentPort, change: (store: Store) => Store): Promise<PageAnnotation[]> {
  for (let attempt = 0; ; attempt++) {
    const at = await read(port);
    const store = change(at ? at.store : { version: 1, annotations: [] });
    try {
      await port.saveWorkspaceFile({ path: STORE, content: JSON.stringify(store, null, 2) + "\n", revision: at ? at.revision : "" });
      return store.annotations;
    } catch (e) {
      const code = e instanceof HttpError ? e.reason?.code : "";
      if (attempt === 0 && (code === "workspace.file_exists" || code === "workspace.file_changed")) continue;
      throw e;
    }
  }
}

export async function listAnnotations(port: AgentPort): Promise<PageAnnotation[]> {
  return (await read(port))?.store.annotations ?? [];
}

export function saveAnnotation(port: AgentPort, ann: PageAnnotation): Promise<PageAnnotation[]> {
  return mutate(port, (store) => ({
    version: 1,
    annotations: store.annotations.some((one) => one.id === ann.id)
      ? store.annotations.map((one) => (one.id === ann.id ? ann : one))
      : store.annotations.concat(ann),
  }));
}

export function deleteAnnotation(port: AgentPort, id: string): Promise<PageAnnotation[]> {
  return mutate(port, (store) => ({ version: 1, annotations: store.annotations.filter((one) => one.id !== id) }));
}

export function marksOf(annotations: PageAnnotation[], pageUrl: string): PageMark[] {
  return annotations
    .filter((one) => one.pageUrl === pageUrl)
    .map((one) => ({ id: one.id, selector: one.selector, note: one.note }));
}

/** What the person's note says to the agent: the page it is on, the element it
 *  pins, and the note itself. */
export function annotationMessage(ann: PageAnnotation): string {
  const element = ann.text ? `${ann.selector}（${ann.tagName}）：“${ann.text}”` : `${ann.selector}（${ann.tagName}）`;
  return `[网页批注] ${ann.pageUrl}\n${element}\n${ann.note}`;
}

export async function submitAnnotation(port: AgentPort, ann: PageAnnotation): Promise<void> {
  const text = annotationMessage(ann);
  try {
    await port.submit(text);
  } catch (e) {
    if (e instanceof HttpError && e.reason?.code === "busy.session_running") {
      await port.queueFollowup(text);
      return;
    }
    throw e;
  }
}
