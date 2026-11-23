// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../port/http_error";
import type { AgentPort } from "../port/port";
import { annotationMessage, deleteAnnotation, listAnnotations, marksOf, saveAnnotation, submitAnnotation, type PageAnnotation } from "./annotations";

const one: PageAnnotation = {
  id: "a1",
  pageUrl: "https://page.test/",
  selector: "#title",
  tagName: "h1",
  text: "Hello",
  note: "needs a rewrite",
  createdAt: 1,
};

function missing(path: string) {
  return new HttpError(404, `no ${path}`, { code: "workspace.file_missing" });
}

function portWith(over: Partial<Record<"workspaceFile" | "saveWorkspaceFile" | "submit" | "queueFollowup", unknown>> = {}) {
  const save = vi.fn(async (file: { path: string; content: string; revision: string }) => ({ ...file, revision: "saved" }));
  const port = {
    workspaceFile: vi.fn(async (path: string) => {
      throw missing(path);
    }),
    saveWorkspaceFile: save,
    submit: vi.fn(async () => {}),
    queueFollowup: vi.fn(async () => ({})),
    ...over,
  } as unknown as AgentPort;
  return { port, save };
}

describe("the annotation store", () => {
  it("creates the store file where there is none, against an empty revision", async () => {
    const { port, save } = portWith();
    expect(await listAnnotations(port)).toEqual([]);
    const after = await saveAnnotation(port, one);
    expect(after).toEqual([one]);
    expect(save).toHaveBeenCalledTimes(1);
    const sent = save.mock.calls[0][0];
    expect(sent.path).toBe(".reasonix/annotations.json");
    expect(sent.revision, "a file said to be new is created").toBe("");
    expect(JSON.parse(sent.content)).toEqual({ version: 1, annotations: [one] });
  });

  it("adds beside what is already there and replaces by id", async () => {
    let content = JSON.stringify({ version: 1, annotations: [one] });
    let revision = "r1";
    const saved: string[] = [];
    const { port } = portWith({
      workspaceFile: vi.fn(async () => ({ path: ".reasonix/annotations.json", content, revision })),
      saveWorkspaceFile: vi.fn(async (file: { content: string; revision: string }) => {
        saved.push(file.revision);
        content = file.content;
        revision = "r2";
        return { ...file, revision };
      }),
    });
    const two = { ...one, id: "b2", note: "second" };
    expect(await saveAnnotation(port, two), "a new note lands beside the one that is there").toEqual([one, two]);
    const edited = { ...one, note: "reworded" };
    expect(await saveAnnotation(port, edited), "a save of an existing id replaces it in place").toEqual([edited, two]);
    expect(saved, "each save stands on the revision it read").toEqual(["r1", "r2"]);
  });

  it("deletes by id and leaves the rest alone", async () => {
    const two = { ...one, id: "b2", note: "second" };
    const stored = { path: ".reasonix/annotations.json", content: JSON.stringify({ version: 1, annotations: [one, two] }), revision: "r1" };
    const { port } = portWith({ workspaceFile: vi.fn(async () => stored) });
    expect(await deleteAnnotation(port, "a1")).toEqual([two]);
  });

  it("retries once on a write that lost the race, then keeps the winner's other notes", async () => {
    const winner = { ...one, id: "w1", note: "theirs" };
    let reads = 0;
    let writes = 0;
    const { port } = portWith({
      workspaceFile: vi.fn(async () => {
        reads++;
        return { path: ".reasonix/annotations.json", content: JSON.stringify({ version: 1, annotations: reads > 1 ? [winner] : [] }), revision: `r${reads}` };
      }),
      saveWorkspaceFile: vi.fn(async (file: { content: string }) => {
        writes++;
        if (writes === 1) throw new HttpError(409, "moved", { code: "workspace.file_changed" });
        return { ...file, revision: "saved" };
      }),
    });
    const after = await saveAnnotation(port, one);
    expect(after, "the retried write carried the concurrent note forward").toEqual([winner, one]);
    expect(writes).toBe(2);
    expect(reads, "the retry stands on a fresh read").toBe(2);
  });

  it("reads a store that is there and tolerates one that does not parse", async () => {
    const { port } = portWith({
      workspaceFile: vi.fn(async () => ({ path: ".reasonix/annotations.json", content: "not json", revision: "r1" })),
    });
    expect(await listAnnotations(port)).toEqual([]);
    const { port: good } = portWith({
      workspaceFile: vi.fn(async () => ({ path: ".reasonix/annotations.json", content: JSON.stringify({ version: 1, annotations: [one, { id: 7 }] }), revision: "r1" })),
    });
    expect(await listAnnotations(good), "a row without an id of its own is not a note").toEqual([one]);
  });
});

describe("marksOf", () => {
  it("keeps the notes of one page and nothing else", () => {
    const other = { ...one, id: "b2", pageUrl: "https://elsewhere/" };
    expect(marksOf([one, other], "https://page.test/")).toEqual([{ id: "a1", selector: "#title", note: "needs a rewrite" }]);
  });
});

describe("sending a note to the agent", () => {
  it("carries the page, the element and the note", () => {
    expect(annotationMessage(one)).toBe('[网页批注] https://page.test/\n#title（h1）：“Hello”\nneeds a rewrite');
    expect(annotationMessage({ ...one, text: undefined })).toBe("[网页批注] https://page.test/\n#title（h1）\nneeds a rewrite");
  });

  it("queues the text when a turn is already running", async () => {
    const { port } = portWith({
      submit: vi.fn(async () => {
        throw new HttpError(409, "busy", { code: "busy.session_running" });
      }),
    });
    await submitAnnotation(port, one);
    expect(port.queueFollowup).toHaveBeenCalledWith(annotationMessage(one));
  });
});
