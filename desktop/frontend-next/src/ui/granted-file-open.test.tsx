// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import type { AgentPort } from "../port/port";
import { MockPort } from "../port/mock";
import { Markdown } from "./Markdown";
import { WorkbenchPanel } from "./WorkbenchPanel";
import { useConversationFiles } from "./useConversationFiles";
import { grantedFilePath, parseGrantedFile } from "./grantedfiles";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const port = {
  workspaceImageURL: (path: string) => path,
  workspaceRoots: () => Promise.resolve({ primary: "/work", extra: ["/library"] }),
  revealsFiles: () => false, opensFiles: () => false,
} as unknown as AgentPort;

async function conversation(reveal = () => {}) {
  const hook = renderHook(() => useConversationFiles(port, "/work", false, true, reveal, () => {}));
  await waitFor(() => expect(hook.result.current.refs.linkable?.("/library/notes/plan.md")).toBeTruthy());
  return hook;
}

it("names a file in a granted folder by the folder and the path inside it, and reads it back", () => {
  const marked = grantedFilePath("/library", "notes/plan.md");
  expect(parseGrantedFile(marked)).toEqual({ root: "/library", rel: "notes/plan.md" });
  expect(parseGrantedFile("notes/plan.md")).toBeNull();
  expect(parseGrantedFile(grantedFilePath("C:\\Docs", "a b/c.md"))).toEqual({ root: "C:\\Docs", rel: "a b/c.md" });
});

it("opens a path in a granted folder from the conversation, and leaves every other absolute path alone", async () => {
  const reveal = vi.fn();
  const { result } = await conversation(reveal);
  const refs = result.current.refs;
  const open = refs.link("/library/notes/plan.md");
  expect(open).toBeTypeOf("function");
  expect(refs.link("file:///library/notes/plan.md")).toBeTypeOf("function");
  expect(refs.link("/elsewhere/notes/plan.md")).toBeNull();
  expect(refs.link("/library/../etc/passwd")).toBeNull();
  act(() => open!());
  expect(reveal).toHaveBeenCalled();
  expect(result.current.request?.path).toBe(grantedFilePath("/library", "notes/plan.md"));
  expect(refs.path?.("/library/notes/plan.md")).toBeNull();
});

it("links a bare path in a granted folder in the conversation and not one outside every grant", async () => {
  const { result } = await conversation();
  const { container } = render(<Markdown text={"see `/library/notes/plan.md` and `/elsewhere/other.md`"} local={result.current.refs} />);
  expect([...container.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["/library/notes/plan.md"]);
});

it("opens a granted file in the workbench read-only, asking the folder and never the diff", async () => {
  const mock = new MockPort();
  const read = vi.spyOn(mock, "workspaceFile").mockResolvedValue({ path: "notes/plan.md", content: "# plan\n", revision: "r1", root: "/library", readOnly: true });
  const diff = vi.spyOn(mock, "changeDiff");
  const save = vi.spyOn(mock, "saveWorkspaceFile");
  const props = { scheme: "dark" as const, shown: true, changes: [], onCloseManual: vi.fn(), onExternal: vi.fn(), manual: true, tabs: [] };
  render(<WorkbenchPanel {...props} port={mock} fileRequest={{ path: grantedFilePath("/library", "notes/plan.md") }} />);
  await waitFor(() => expect(read).toHaveBeenCalledWith("notes/plan.md", "/library"));
  expect(diff).not.toHaveBeenCalled();
  await waitFor(() => expect(document.querySelector(".workbench-read")?.textContent).toContain("plan"));
  expect(document.querySelector('[data-action="workbench.save"]')).toBeNull();
  expect(document.querySelector('[data-action="workbench.mode"][data-value="diff"]')).toBeNull();
  expect(screen.getByText(/只读|Read-only/)).toBeTruthy();
  expect(document.querySelector(".workbench-filebar strong")?.textContent).toBe("/library/notes/plan.md");
  expect(document.querySelector('.workbench-filebar [data-action="workbench.reveal"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("opens the granted file a clicked path names, spaces and all", async () => {
  const spaced = { ...port, workspaceRoots: () => Promise.resolve({ primary: "/work", extra: ["/my library"] }) } as unknown as AgentPort;
  const hook = renderHook(() => useConversationFiles(spaced, "/work", false, true, () => {}, () => {}));
  await waitFor(() => expect(hook.result.current.refs.linkable?.("/my library/a b/plan.md")).toBeTruthy());
  const { container } = render(<Markdown text={"[the plan](/my%20library/a%20b/plan.md)"} local={hook.result.current.refs} />);
  fireEvent.click(container.querySelector("a")!);
  expect(hook.result.current.request?.path).toBe(grantedFilePath("/my library", "a b/plan.md"));
});
