// @vitest-environment jsdom
import "./testkit";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MockPort } from "../port/mock";
import type { BrowserTab } from "../port/port";
import { WorkbenchPanel } from "./WorkbenchPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const pages: BrowserTab[] = [
  { id: "a", target: "ta", title: "Alpha", url: "https://a.example", active: true },
  { id: "b", target: "tb", title: "Beta", url: "https://b.example", active: false },
  { id: "c", target: "tc", title: "Gamma", url: "https://c.example", active: false },
];
function draw(tabs = pages, manual = false) {
  const port = new MockPort();
  const close = vi.spyOn(port, "browserClose");
  const props = { port, tabs, manual, shown: true, scheme: "light" as const, changes: [],
    onCloseManual: vi.fn(), onExternal: vi.fn() };
  const view = render(<WorkbenchPanel {...props} />);
  return { ...props, close, update: (next: BrowserTab[]) => view.rerender(<WorkbenchPanel {...props} tabs={next} />) };
}
const pick = (name: string) => within(screen.getByRole("tab", { name })).getByRole("button", { name });
const offer = (name: string) => fireEvent.contextMenu(pick(name), { clientX: 180, clientY: 50 });

it("offers a menu on an inactive browser tab without changing the selected page", async () => {
  const pane = draw();
  offer("Beta");
  expect(screen.getByRole("menu", { name: "标签" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  expect(screen.queryByRole("tab", { name: "Beta" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  expect(pane.close).toHaveBeenCalledExactlyOnceWith("b");
  expect(pane.onCloseManual).not.toHaveBeenCalled();
  expect(pages).toHaveLength(3);
});

it("closes every tab to the left of the menu's own tab, and keeps it open", async () => {
  const pane = draw();
  offer("Gamma");
  const left = screen.getByRole("menuitem", { name: "关闭左侧标签" });
  expect(left.querySelector("kbd")!.textContent, "Alpha and Beta are to the left").toBe("2");
  await userEvent.click(left);
  expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Beta" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
  expect(pane.close).toHaveBeenCalledWith("a");
  expect(pane.close).toHaveBeenCalledWith("b");
});

it("offers the left-side close shut on the first tab, where nothing is to its left", async () => {
  draw();
  offer("Alpha");
  const left = screen.getByRole("menuitem", { name: "关闭左侧标签" });
  expect((left as HTMLButtonElement).disabled).toBe(true);
  // The count is left off entirely rather than shown as 0: there is no number
  // of tabs to close, and "0" beside a shut entry reads as a bug.
  expect(left.querySelector("kbd")).toBeNull();
});

it("closes the whole strip to the left when the menu's tab is the last one", async () => {
  // The file opens after the pages, so every page is to its left: the batch is
  // the run from the start of the strip up to the menu's own tab.
  const pane = draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  offer("README.md");
  const left = screen.getByRole("menuitem", { name: "关闭左侧标签" });
  expect(left.querySelector("kbd")!.textContent, "all three pages are to the left").toBe("3");
  await userEvent.click(left);
  expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Beta" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Gamma" })).toBeNull();
  expect(screen.getByRole("tab", { name: "README.md" }), "the menu's own tab stays").toBeTruthy();
  expect(pane.close).toHaveBeenCalledWith("a");
  expect(pane.close).toHaveBeenCalledWith("b");
  expect(pane.close).toHaveBeenCalledWith("c");
});

it("leaves an unsaved file on the left out of the batch, and says so in the count", async () => {
  // A file with unsaved text sits left of the menu's tab, so the batch would
  // reach it — `close` drops what it is given without asking, so it has to be
  // filtered out, and the number beside the entry has to be the number it
  // really closes.
  draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const editor = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".cm-content");
    if (!element) throw new Error("editor not mounted");
    return element;
  });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\n## Unsent edit" } }));

  // A second file, so the menu can open on a tab to the right of the first.
  fireEvent.change(screen.getByRole("textbox", { name: "搜索文件" }), { target: { value: "retry" } });
  fireEvent.click(await waitFor(() => {
    const row = document.querySelector<HTMLElement>('.workbench-tree-row[data-target="internal/provider/retry.go"]');
    if (!row) throw new Error("retry.go not listed");
    return row;
  }));

  offer("retry.go");
  // Three pages sit left of retry.go and are closable; the file is left too,
  // but its text is unsaved, so the batch is the three pages.
  const left = screen.getByRole("menuitem", { name: "关闭左侧标签" });
  expect(left.querySelector("kbd")!.textContent, "the count leaves the unsaved file out").toBe("3");
  await userEvent.click(left);
  expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Gamma" })).toBeNull();
  expect(screen.getByRole("tab", { name: "README.md" }), "the unsaved file is still open").toBeTruthy();
  expect(view.state.doc.toString()).toContain("## Unsent edit");
});

it("closes other tabs while keeping the menu's own tab and any tab with unsaved text", async () => {
  draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const editor = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".cm-content");
    if (!element) throw new Error("editor not mounted");
    return element;
  });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\n## Unsent edit" } }));
  offer("Beta");
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭其他标签" }));
  expect(screen.queryByRole("tab", { name: "Alpha" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "Gamma" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "README.md" }).getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(pick("Beta"));
  expect(document.querySelector(".cm-content")).toBe(editor);
  expect(view.state.doc.toString()).toContain("## Unsent edit");
});

it("closes every tab to the right, file tabs included, and keeps the selection", async () => {
  const pane = draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await userEvent.click(pick("Alpha"));
  offer("Beta");
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));
  expect(screen.queryByRole("tab", { name: "Gamma" })).toBeNull();
  expect(screen.getByRole("tab", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Beta" })).toBeTruthy();
  // The file sits after the pages in the strip, so it is to the right too.
  expect(screen.queryByRole("tab", { name: "README.md" })).toBeNull();
  expect(pane.close).toHaveBeenCalledExactlyOnceWith("c");
});

it("leaves a tab with unsaved text out of a bulk close, and says so in the count", async () => {
  // `close` drops what it is given without asking, so a batch may not carry a
  // file that would lose its edit — and the number beside the entry has to be
  // the number it really closes, or the menu is lying about what a press does.
  draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const editor = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".cm-content");
    if (!element) throw new Error("editor not mounted");
    return element;
  });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\n## Unsent edit" } }));

  offer("Alpha");
  // Gamma is to the right of Alpha and is closable; the file is too, but its
  // text is unsaved, so the batch is just Gamma.
  const right = screen.getByRole("menuitem", { name: "关闭右侧标签" });
  expect(right.querySelector("kbd")!.textContent, "the count leaves the unsaved file out").toBe("2");
  expect(screen.getByRole("menuitem", { name: "关闭其他标签" }).querySelector("kbd")!.textContent).toBe("2");
  expect(screen.getByRole("menuitem", { name: "关闭全部标签" }).querySelector("kbd")!.textContent).toBe("3");

  await userEvent.click(right);
  expect(screen.getByRole("tab", { name: "README.md" }), "the unsaved file is still open").toBeTruthy();
  expect(view.state.doc.toString()).toContain("## Unsent edit");
});

it("asks before closing an unsaved file from its own tab's menu, with focus in the question", async () => {
  // The × on the tab asks; the menu's close is the same press reached another
  // way, so it asks too. Focus has to land in the question — the strip's
  // hand-back would otherwise take it straight out.
  draw();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  const editor = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(".cm-content");
    if (!element) throw new Error("editor not mounted");
    return element;
  });
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: "\n\n## Unsent edit" } }));

  offer("README.md");
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  const ask = await screen.findByRole("alertdialog");
  expect(ask.textContent).toContain("还没保存");
  expect(document.activeElement, "focus is in the question, not back on the strip").toBe(
    within(ask).getByRole("button", { name: "保存" }),
  );
  // The tab is still open while the question is up: nothing was closed.
  expect(screen.getByRole("tab", { name: "README.md" })).toBeTruthy();
  expect(view.state.doc.toString()).toContain("## Unsent edit");
});

it("retains a refused right-side page and disables close controls while awaiting the controller", async () => {
  let refuse: ((error: Error) => void) | undefined;
  const pane = draw();
  pane.close.mockImplementation(() => new Promise<void>((_resolve, reject) => { refuse = reject; }));
  offer("Beta");
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭右侧标签" }));
  expect(pane.close).toHaveBeenCalledExactlyOnceWith("c");
  expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
  expect((screen.getByRole("button", { name: "关闭 Gamma" }) as HTMLButtonElement).disabled).toBe(true);
  offer("Beta");
  expect(screen.queryByRole("menu")).toBeNull();
  await act(async () => refuse?.(new Error("controller refused close")));
  expect(screen.getByRole("tab", { name: "Gamma" })).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("controller refused close");
  expect((screen.getByRole("button", { name: "关闭 Gamma" }) as HTMLButtonElement).disabled).toBe(false);
});

it("disables empty bulk choices and offers a new tab with its last browser", async () => {
  const pane = draw([pages[0]!]);
  offer("Alpha");
  expect((screen.getByRole("menuitem", { name: "关闭其他标签" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("menuitem", { name: "关闭右侧标签" }) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  expect(pane.onCloseManual).not.toHaveBeenCalled();
  expect(screen.getByRole("group", { name: "开始" })).toBeTruthy();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("supports keyboard opening and menu navigation, then focuses the remaining tab", async () => {
  draw();
  await userEvent.click(pick("Beta"));
  await userEvent.keyboard("{Shift>}{F10}{/Shift}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "关闭其他标签" }));
  await userEvent.keyboard("{Home}{Enter}");
  expect(screen.queryByRole("tab", { name: "Beta" })).toBeNull();
  expect(document.activeElement).toBe(pick("Alpha"));
});

it("cancels with Escape without dismissing a tab and restores the trigger's focus", async () => {
  const pane = draw();
  offer("Beta");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(pick("Beta"));
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(pane.onCloseManual).not.toHaveBeenCalled();
});

it("drops a menu whose browser disappears, and offers one on a file tab too", async () => {
  const pane = draw();
  offer("Beta");
  pane.update([pages[0]!, pages[2]!]);
  expect(screen.queryByRole("menu")).toBeNull();
  await userEvent.click(await screen.findByRole("button", { name: "README.md" }));
  // A file is a tab, so the strip's own menu covers it: before this, the only
  // way to close a file was the × on its tab, and the right-hand press fell
  // through to Chromium's.
  expect(offer("README.md")).toBe(false);
  expect(screen.getByRole("menu", { name: "标签" })).toBeTruthy();
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  expect(screen.queryByRole("tab", { name: "README.md" })).toBeNull();
  expect(document.querySelector(".cm-content")).toBeNull();
});

it("offers the same actions on manual browser tabs", async () => {
  const pane = draw([], true);
  for (let n = 0; n < 2; n++) {
    await userEvent.click(screen.getByRole("button", { name: "新建标签" }));
    await userEvent.click(screen.getAllByRole("button", { name: "浏览器" }).at(-1)!);
  }
  const tabs = screen.getAllByRole("tab", { name: "浏览器" });
  fireEvent.contextMenu(within(tabs[1]!).getByRole("button", { name: "浏览器" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "关闭其他标签" }));
  expect(screen.getAllByRole("tab", { name: "浏览器" })).toHaveLength(1);
  expect(pane.onCloseManual).not.toHaveBeenCalled();
});
it("leaves the native menu available when the tab title has selected text", () => {
  draw();
  const title = pick("Beta").querySelector("span")!;
  const range = document.createRange();
  range.selectNodeContents(title);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  try {
    expect(offer("Beta")).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  } finally { selection.removeAllRanges(); }
});

it("dismisses the menu on an outside press and skips disabled menu items by keyboard", async () => {
  draw([pages[0]!]);
  offer("Alpha");
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "关闭全部标签" }));
  await userEvent.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "关闭当前标签" }));
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(pick("Alpha"));
  expect(screen.getByRole("tab", { name: "Alpha" })).toBeTruthy();
});
