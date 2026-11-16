// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeSession, TreeWorkspace } from "../port/hub";

vi.mock("../port/host", () => ({ host: () => ({ revealsFiles: () => true }) }));

afterEach(cleanup);

function draw(over: Partial<TreeWorkspace> = {}, sessions: Record<string, TreeSession[]> = {}) {
  const tree: TreeWorkspace[] = ["a", "b"].map((name) => ({
    root: "/" + name, name, remembered: true, sessions: sessions[name] ?? [], ...over,
  }));
  const revealWorkspace = vi.fn().mockResolvedValue(undefined);
  const moveWorkspace = vi.fn().mockResolvedValue(undefined);
  const removeWorkspace = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn().mockResolvedValue(undefined);
  const onFold = vi.fn();
  const onOpen = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Workspaces hub={{ revealWorkspace, moveWorkspace, removeWorkspace, openWithTargets: async () => [] } as never} tree={tree} treeRead
    runtimes={[]} active="" folded={new Set()} onFold={onFold} reload={reload} onOpen={onOpen}
    onFocus={() => {}} onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}}
    onError={onError} adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  const row = (name: string) => screen.getByText(name, { selector: ".wsname" }).closest<HTMLElement>('[role="treeitem"]')!;
  return { row, revealWorkspace, moveWorkspace, removeWorkspace, reload, onFold, onOpen, onError };
}

it("opens the existing project menu from a right click without folding or opening a session", () => {
  const { row, onFold, onOpen } = draw();
  expect(fireEvent.contextMenu(row("b"), { clientX: 120, clientY: 90 })).toBe(false);
  expect(screen.getByRole("menu", { name: "项目操作" })).toBeTruthy();
  // The menu opens ON the rename row: it is the reference menu's own first
  // word, and the focus starts where a rename would begin.
  expect(screen.getByRole("menuitem", { name: "重命名项目" })).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "重命名项目" }));
  expect(screen.getByRole("menuitem", { name: /在文件管理器中显示/ })).toBeTruthy();
  expect(onFold).not.toHaveBeenCalled();
  expect(onOpen).not.toHaveBeenCalled();
});

it.each(["{ContextMenu}", "{Shift>}{F10}{/Shift}"])("opens from %s and restores row focus on Escape", async (key) => {
  const { row } = draw();
  row("b").focus();
  await userEvent.keyboard(key);
  expect(screen.getByRole("menu", { name: "项目操作" })).toBeTruthy();
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /移除/ }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row("b"));
});

it("reveals the right-clicked project and returns focus to its row", async () => {
  const { row, revealWorkspace } = draw();
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  expect(revealWorkspace).toHaveBeenCalledExactlyOnceWith("/b");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(row("b"));
});

it("reuses the removal confirmation from the context menu", async () => {
  const { row, removeWorkspace } = draw();
  // Movement left the menu for the row's own drag (workspace-drag covers the
  // walk and its reload); the confirm stays the menu's own work.
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /移除/ }));
  expect(screen.getByRole("alertdialog").textContent).toContain("从列表移除「b」？");
  expect(removeWorkspace).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "移除" }));
  await waitFor(() => expect(removeWorkspace).toHaveBeenCalledExactlyOnceWith("/b"));
});

it("switches the context menu to another project and preserves normal row and add clicks", async () => {
  const { row, revealWorkspace, onFold, onOpen } = draw();
  fireEvent.contextMenu(row("a"));
  fireEvent.contextMenu(row("b"));
  expect(screen.getAllByRole("menu")).toHaveLength(1);
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  expect(revealWorkspace).toHaveBeenCalledExactlyOnceWith("/b");
  await userEvent.click(row("a"));
  expect(onFold).not.toHaveBeenCalled();
  expect(row("a").hasAttribute("aria-expanded")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "在 b 下新建会话" }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith({ root: "/b" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps unavailable actions disabled and reports reveal failures", async () => {
  const missing = draw({ missing: true });
  fireEvent.contextMenu(missing.row("b"));
  expect((screen.getByRole("menuitem", { name: /在文件管理器中显示/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(missing.revealWorkspace).not.toHaveBeenCalled();
  cleanup();
  const { row, revealWorkspace, onError } = draw();
  const refusal = new Error("folder unavailable");
  revealWorkspace.mockRejectedValueOnce(refusal);
  fireEvent.contextMenu(row("b"));
  await userEvent.click(screen.getByRole("menuitem", { name: /在文件管理器中显示/ }));
  await waitFor(() => expect(onError).toHaveBeenCalledExactlyOnceWith(refusal));
});

it("starts picking with the project's visible sessions from its menu", async () => {
  const pane = draw({}, {
    a: [{ path: "/a/x.jsonl", name: "x", title: "X" }, { path: "/a/y.jsonl", name: "y", title: "Y" }],
    b: [{ path: "/b/z.jsonl", name: "z", title: "Z" }],
  });
  fireEvent.contextMenu(pane.row("a"));
  await userEvent.click(screen.getByRole("menuitem", { name: /批量管理/ }));
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByText("已选 2 个会话")).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "X" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "Y" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "Z" }).getAttribute("aria-selected")).toBe("false");
  expect(pane.onOpen).not.toHaveBeenCalled();
});

it("offers no batch entry for a project with nothing to pick", () => {
  const pane = draw();
  fireEvent.contextMenu(pane.row("a"));
  expect((screen.getByRole("menuitem", { name: /批量管理/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.querySelector(".session-batch")).toBeNull();
});
