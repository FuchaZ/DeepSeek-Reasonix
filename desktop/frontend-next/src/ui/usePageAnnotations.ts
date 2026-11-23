import { useCallback, useMemo, useRef, useState } from "react";
import type { PickedElement } from "../port/host";
import type { AgentPort } from "../port/port";
import { deleteAnnotation, listAnnotations, saveAnnotation, submitAnnotation, type AnnotateCapability, type PageAnnotation } from "./annotations";

/** The person's notes on the workspace's pages, kept in the workspace and
 *  handed to the agent on request. The store is read on the first ask — a
 *  workbench that never opens a page has no use for it. */
export function usePageAnnotations(port: AgentPort): AnnotateCapability {
  const [annotations, setAnnotations] = useState<PageAnnotation[]>([]);
  const loaded = useRef(false);

  const ensure = useCallback(async () => {
    if (loaded.current) return;
    loaded.current = true;
    try {
      setAnnotations(await listAnnotations(port));
    } catch {
      loaded.current = false;
    }
  }, [port]);

  const save = useCallback(
    async (element: PickedElement, note: string, pageUrl: string) => {
      const ann: PageAnnotation = {
        id: crypto.randomUUID(),
        pageUrl: pageUrl || element.pageUrl || "",
        selector: element.selector,
        tagName: element.tagName,
        text: element.text,
        note,
        createdAt: Date.now(),
      };
      loaded.current = true;
      setAnnotations(await saveAnnotation(port, ann));
    },
    [port],
  );

  const remove = useCallback(
    async (id: string) => {
      loaded.current = true;
      setAnnotations(await deleteAnnotation(port, id));
    },
    [port],
  );

  const submit = useCallback((ann: PageAnnotation) => submitAnnotation(port, ann), [port]);

  return useMemo(() => ({ annotations, ensure, save, remove, submit }), [annotations, ensure, save, remove, submit]);
}
