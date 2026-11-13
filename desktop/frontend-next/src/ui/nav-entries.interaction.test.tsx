// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { MockHub } from "../port/mock_hub";
import type { TreeWorkspace } from "../port/hub";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";
import { NO_PAGING } from "./treewindow";
import { NavEntriesSection } from "./NavEntriesSection";

const props = { at: null, onGo: vi.fn(), onFiles: vi.fn(), onFeedback: vi.fn(), onNew: vi.fn(), feedbackUnread: 0, shown: true, wallet: "", approval: undefined, online: 0, hideAmounts: false, onSearch: vi.fn() };

beforeEach(() => { localStorage.clear(); localStorage.setItem("rx-nav-rail", "on"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rail = () => [...document.querySelectorAll(".nav .navgrp:not(.foot) button")].map((b) => b.getAttribute("aria-label"));

function both() {
  render(<><NavEntriesSection /><Nav {...props} /></>);
}

it("draws the rail in the declared order until this machine chooses otherwise", () => {
  both();
  expect(rail()).toEqual(["新建会话", "搜索会话与操作", "用量", "文件", "工具与权限", "扩展", "记忆", "远程", "定时运行"]);
});

it("hides a destination from the rail when its switch is turned off, and brings it back", async () => {
  both();
  await userEvent.click(screen.getByRole("switch", { name: "显示：记忆" }));
  expect(rail()).not.toContain("记忆");
  expect(screen.getByRole("switch", { name: "显示：记忆" }).getAttribute("aria-checked")).toBe("false");
  await userEvent.click(screen.getByRole("switch", { name: "显示：记忆" }));
  expect(rail()).toContain("记忆");
});

it("moves a destination up and down, and the rail follows", async () => {
  both();
  await userEvent.click(screen.getByRole("button", { name: "上移：远程" }));
  await userEvent.click(screen.getByRole("button", { name: "上移：远程" }));
  expect(rail()).toEqual(["新建会话", "搜索会话与操作", "用量", "文件", "工具与权限", "远程", "扩展", "记忆", "定时运行"]);
  await userEvent.click(screen.getByRole("button", { name: "下移：远程" }));
  expect(rail().slice(-3)).toEqual(["远程", "记忆", "定时运行"]);
});

it("cannot move the first entry up or the last one down", () => {
  both();
  // Search leads the list now that New session is fixed and out of it.
  expect((screen.getByRole("button", { name: "上移：搜索会话与操作" }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: "下移：定时运行" }) as HTMLButtonElement).disabled).toBe(true);
});

it("restores the arrangement, and offers that only after a change", async () => {
  both();
  const reset = screen.getByRole("button", { name: "还原排列" }) as HTMLButtonElement;
  expect(reset.disabled).toBe(true);
  await userEvent.click(screen.getByRole("switch", { name: "显示：文件" }));
  expect(reset.disabled).toBe(false);
  await userEvent.click(reset);
  expect(rail()).toContain("文件");
  expect(reset.disabled).toBe(true);
});

const tree: TreeWorkspace[] = [{ root: "/work/alpha", name: "alpha", remembered: true, sessions: [] }];

function sidebar() {
  const noop = vi.fn();
  render(
    <Sidebar
      onFiles={noop} onView={noop} hub={new MockHub()} collapsed={false} navShown={false} paging={NO_PAGING} tree={tree} treeRead runtimes={[]} runs={{}} active=""
      activeWorkspace={tree[0]} liveIds={() => []} pinned={new Set()} onPin={noop} remotes={null} remoteTrees={{}}
      reloadRemotes={async () => {}} reloadRemoteTrees={async () => {}} readRemoteTree={async () => {}} reloadTree={async () => {}}
      adder={{ busy: false, add: noop, addPath: noop } as never} onOpen={async () => {}} onOpenRemote={async () => {}} onFocusPane={noop} onClosePanes={async () => {}}
      onPause={noop} onArchive={async () => {}} onRename={noop} onCollapse={noop} wallet=""
      onSettings={noop} onFeedback={noop} feedbackUnread={0} onFind={noop} onError={noop}
    />,
  );
}

const shortcuts = () => [...document.querySelectorAll(".studio-navrow")].map((b) => b.getAttribute("aria-label"));

it("keeps a named Settings row when every optional shortcut is hidden", async () => {
  render(<NavEntriesSection />);
  sidebar();
  for (const name of ["用量", "文件", "工具与权限", "扩展", "记忆", "远程"]) await userEvent.click(screen.getByRole("switch", { name: `显示：${name}` }));
  expect(document.querySelector(".studio-settings")?.textContent).toContain("设置");
  expect(screen.queryByRole("button", { name: "侧栏入口" })).toBeNull();
});

it("gives the sidebar the same order and the same hidden entries as the rail", async () => {
  render(<NavEntriesSection />);
  sidebar();
  expect(shortcuts()).toEqual(["用量", "文件", "工具与权限", "扩展", "记忆", "远程", "定时运行"]);
  await userEvent.click(screen.getByRole("button", { name: "上移：远程" }));
  await userEvent.click(screen.getByRole("button", { name: "上移：远程" }));
  await userEvent.click(screen.getByRole("switch", { name: "显示：记忆" }));
  expect(shortcuts()).toEqual(["用量", "文件", "工具与权限", "远程", "扩展", "定时运行"]);
});

it("takes the wallet row out of the sidebar when Usage is hidden", async () => {
  render(<NavEntriesSection />);
  sidebar();
  expect(document.querySelector('.studio-navrow[data-value="spend"]')).not.toBeNull();
  await userEvent.click(screen.getByRole("switch", { name: "显示：用量" }));
  expect(document.querySelector('.studio-navrow[data-value="spend"]')).toBeNull();
});

it("opens the arrangement panel from the bar's right press, and closes it on Escape", async () => {
  render(<NavEntriesSection />);
  sidebar();
  // No row of its own: the bar is the trigger, so nothing here opens a menu.
  expect(screen.queryByRole("button", { name: "更多" })).toBeNull();
  const bar = document.querySelector(".studio-navlist") as HTMLElement;
  fireEvent.contextMenu(bar);
  // Two steps: the right press offers a menu, and choosing the one item opens
  // the panel. A stray right press must not throw the window's middle open.
  expect(screen.queryByRole("dialog", { name: "自定义导航栏" })).toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: "自定义导航栏" }));
  const panel = screen.getByRole("dialog", { name: "自定义导航栏" });
  // One flat list: the two commands first, then every place the bar goes, in
  // the order the bar draws them.
  const rows = () => [...panel.querySelectorAll<HTMLElement>(".studio-navbar-row")];
  expect(rows().map((row) => row.querySelector(".studio-navbar-go span")?.textContent)).toEqual([
    "新建会话", "搜索会话与操作", "用量", "文件", "工具与权限", "扩展", "记忆", "远程", "定时运行",
  ]);
  // New session is the bar's way out of anything, so it has no switch; every
  // other row — search included — can be hidden.
  expect(within(rows()[0]!).queryByRole("switch")).toBeNull();
  expect(within(rows()[1]!).getByRole("switch")).toBeTruthy();
  // The grip reorders without a drag, because a drag is not a keyboard gesture.
  const grip = screen.getByRole("button", { name: "拖动排序：远程" });
  grip.focus();
  await userEvent.keyboard("{ArrowUp}");
  // One step up from the end: 定时运行 is the last row, 记忆 follows 远程.
  expect(rows().at(-3)!.querySelector(".studio-navbar-go span")?.textContent).toBe("远程");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "自定义导航栏" })).toBeNull();
});

it("names the approval mode on the tools entry once the session reports one", () => {
  sidebar();
  const tools = () => document.querySelector('.studio-navrow[data-value="tools"]')!.getAttribute("aria-label");
  expect(tools()).toBe("工具与权限");
  cleanup();
  const noop = vi.fn();
  render(
    <Sidebar
      onFiles={noop} onView={noop} hub={new MockHub()} collapsed={false} navShown={false} paging={NO_PAGING} tree={tree} treeRead runtimes={[]} runs={{}} active=""
      activeWorkspace={tree[0]} liveIds={() => []} pinned={new Set()} onPin={noop} remotes={null} remoteTrees={{}}
      reloadRemotes={async () => {}} reloadRemoteTrees={async () => {}} readRemoteTree={async () => {}} reloadTree={async () => {}}
      adder={{ busy: false, add: noop, addPath: noop } as never} onOpen={async () => {}} onOpenRemote={async () => {}} onFocusPane={noop} onClosePanes={async () => {}}
      onPause={noop} onArchive={async () => {}} onRename={noop} onCollapse={noop} wallet="¥110.00" approval="ask"
      onSettings={noop} onFeedback={noop} feedbackUnread={0} onFind={noop} onError={noop}
    />,
  );
  expect(tools()).toBe("工具与权限 · 询问");
  expect(document.querySelector('.studio-navrow[data-value="spend"]')!.getAttribute("aria-label")).toBe("用量 · ¥110.00");
});
