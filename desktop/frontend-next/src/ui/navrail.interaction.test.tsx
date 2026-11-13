// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// These tests describe the feedback channel while it exists; the shipped build has it retired.
vi.mock("../feedbackchannel", () => ({ FEEDBACK_RETIRED: false }));
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { MockHub } from "../port/mock_hub";
import { boot, STORAGE } from "../i18n";
import { refresh } from "./viewport";

const KEY = "rx-nav-rail";

// jsdom lays nothing out, so the width the fold reads is whatever is said here.
function room(width: number) {
  vi.spyOn(document.body, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(document.body, "clientHeight", "get").mockReturnValue(900);
  refresh();
}

beforeEach(async () => {
  await import("./Settings");
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem(STORAGE, "zh");
  localStorage.setItem(KEY, "collapsed");
  boot();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  HTMLElement.prototype.setPointerCapture = vi.fn();
  room(1440);
});
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  delete document.documentElement.dataset.fold;
  vi.restoreAllMocks();
});

async function open() {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  const prepared = new WeakSet();
  hub.portFor = (rt) => {
    const port = build(rt);
    if (!prepared.has(port)) {
      prepared.add(port);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
    }
    return port;
  };
  const view = render(<App hub={hub} />);
  await screen.findByRole("combobox", { name: "任务输入" });
  return { hub, view };
}

const nav = () => screen.queryByRole("navigation", { name: "主导航" });
const navEl = () => document.querySelector<HTMLElement>("nav.nav");
const app = () => document.querySelector<HTMLElement>(".app")!;
const toggleSidebar = () => userEvent.keyboard("{Control>}b{/Control}");

async function openAppearance() {
  await userEvent.click(document.querySelector<HTMLElement>('[data-action="chrome.settings"]')!);
  await userEvent.click(await screen.findByRole("tab", { name: /^操作与性能/ }));
  await screen.findByRole("group", { name: "图标栏" });
}
const choice = (name: string) => screen.getByRole("button", { name });
const pressed = (name: string) => choice(name).getAttribute("aria-pressed");

it("offers the tools destination only through the navigation entries, not a second button in the top bar", async () => {
  await open();
  await toggleSidebar();
  expect(screen.queryByRole("button", { name: "沙盒" })).toBeNull();
  // The entry names its reading too ("工具与权限 · 询问"), as the sidebar's does.
  expect(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("button", { name: /^工具与权限/ })).toBeTruthy();
});

it("draws no rail until one is chosen", async () => {
  localStorage.removeItem(KEY);
  await open();
  expect(nav()).toBeNull();
  expect(app().dataset.nav).toBe("off");
});

it("draws the rail when it is chosen, with every entry in it", async () => {
  await open();
  await toggleSidebar();
  expect(nav()).not.toBeNull();
  expect(app().dataset.nav).toBe("on");
  expect(document.querySelector(".railfoot")).toBeNull();
  for (const name of ["新建会话", "搜索会话与操作", "用量", "文件", "工具与权限", "扩展", "记忆", "远程", "发送反馈", "设置"]) {
    expect(within(navEl()!).getByRole("button", { name: new RegExp(`^${name}`) }), name).toBeTruthy();
  }
  // The conversation item is gone: the sidebar's own collapse button does that.
  expect(within(navEl()!).queryByRole("button", { name: /^会话$/ })).toBeNull();
});

it.each([
  [null, "off"],
  ["on", "collapsed"],
  ["off", "off"],
  ["collapsed", "collapsed"],
  ["true", "off"],
  ["", "off"],
])("reads a stored %j as %s", async (stored, mode) => {
  if (stored === null) localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, stored);
  await open();
  await openAppearance();
  const label = { collapsed: "仅侧栏收起时显示", off: "不显示" }[mode as "collapsed"];
  expect(pressed(label)).toBe("true");
});

it("offers two states, and the standing one is gone", async () => {
  await open();
  await openAppearance();
  // No third choice is drawn: showing the same six entries twice was the thing
  // the sidebar's own tool card already does.
  expect(screen.queryByRole("button", { name: "始终显示" })).toBeNull();
  expect(choice("仅侧栏收起时显示")).toBeTruthy();
  expect(choice("不显示")).toBeTruthy();
});

it("moves between the two states at once and keeps the choice across a reload", async () => {
  const first = await open();
  await openAppearance();
  await userEvent.click(choice("不显示"));
  expect(nav()).toBeNull();
  expect(app().dataset.nav).toBe("off");
  expect(localStorage.getItem(KEY)).toBe("off");
  await userEvent.click(choice("仅侧栏收起时显示"));
  expect(localStorage.getItem(KEY)).toBe("collapsed");
  first.view.unmount();
  await open();
  expect(localStorage.getItem(KEY)).toBe("collapsed");
});

it("in collapsed mode follows the sidebar without remounting the rail", async () => {
  localStorage.setItem(KEY, "collapsed");
  await open();
  const el = navEl()!;
  expect(el).not.toBeNull();
  expect(app().dataset.rail).toBe("on");
  expect(app().dataset.nav).toBe("off");
  expect(nav()).toBeNull();
  expect(document.querySelector(".railfoot")).not.toBeNull();
  await toggleSidebar();
  expect(app().dataset.rail).toBe("off");
  expect(app().dataset.nav).toBe("on");
  expect(nav()).not.toBeNull();
  expect(document.querySelector(".railfoot")).toBeNull();
  expect(navEl()).toBe(el);
  await toggleSidebar();
  expect(app().dataset.nav).toBe("off");
  expect(document.querySelector(".railfoot")).not.toBeNull();
  expect(navEl()).toBe(el);
});

it("keeps the rail element across the sidebar toggle rather than rebuilding it", async () => {
  await open();
  await toggleSidebar();
  const el = navEl()!;
  expect(el).not.toBeNull();
  await toggleSidebar();
  expect(app().dataset.nav).toBe("off");
  expect(navEl()).toBe(el);
});

it("still reaches settings with the rail off", async () => {
  localStorage.setItem(KEY, "off");
  await open();
  const footer = document.querySelector<HTMLElement>(".railfoot")!;
  expect(footer).not.toBeNull();
  for (const name of ["发送反馈", "设置"]) {
    expect(within(footer).getByRole("button", { name: new RegExp(`^${name}`) }), name).toBeTruthy();
  }
  await openAppearance();
  expect(pressed("不显示")).toBe("true");
});

it.each(["collapsed", "off"])("reaches usage, account, and settings with the rail %s", async (mode) => {
  localStorage.setItem(KEY, mode);
  await open();
  const railShown = mode === "collapsed";
  if (railShown) await toggleSidebar();
  const entries = railShown ? navEl()! : document.querySelector<HTMLElement>(".rail")!;
  for (const [label, section, action] of [["用量", "storage"], ["设置", "session", "chrome.settings"]]) {
    const button = within(entries).getByRole("button", { name: new RegExp(`^${label}`) });
    if (action) expect(entries.querySelector(`[data-action="${action}"]`)).toBe(button);
    await userEvent.click(button);
    expect((await screen.findByRole("tabpanel")).getAttribute("data-sec")).toBe(section);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "设置" })).toBeNull();
  }
});

it("never draws the rail under the scene fold, in any state, and restores it after", async () => {
  for (const mode of ["collapsed", "off"]) {
    cleanup();
    localStorage.setItem(KEY, mode);
    room(1440);
    await open();
    await toggleSidebar();
    expect(nav() !== null, mode).toBe(mode === "collapsed");
    act(() => room(390));
    await waitFor(() => expect(nav()).toBeNull());
    expect(navEl()).toBeNull();
    expect(document.querySelector(".railfoot")).not.toBeNull();
    expect(localStorage.getItem(KEY)).toBe(mode);
    act(() => room(1440));
    await waitFor(() => expect(nav() !== null).toBe(mode === "collapsed"));
    expect(document.querySelector(".railfoot") !== null).toBe(mode === "off");
  }
});

it("opens feedback from the rail like the sidebar entry does, badge included", async () => {
  const hub = new MockHub();
  const build = hub.portFor.bind(hub);
  const prepared = new WeakSet();
  hub.portFor = (rt) => {
    const port = build(rt);
    if (!prepared.has(port)) {
      prepared.add(port);
      port.providerSetup = async () => null;
      port.welcomeSeen = async () => true;
    }
    return port;
  };
  render(<App hub={hub} />);
  await screen.findByRole("combobox", { name: "任务输入" });
  await toggleSidebar();
  const entry = await within(navEl()!).findByRole("button", { name: /发送反馈.*3 项待查看/ });
  expect(entry.querySelector(".fbk-badge")?.textContent).toBe("3");
  await userEvent.click(entry);
  expect(await screen.findByRole("tab", { name: "我的反馈", selected: true })).toBeTruthy();
});

it("the rail starts a session and opens the palette, the same two the sidebar leads with", async () => {
  await open();
  await toggleSidebar();
  expect(app().dataset.rail).toBe("off");
  await userEvent.click(within(navEl()!).getByRole("button", { name: /^搜索会话与操作/ }));
  expect(await screen.findByRole("dialog", { name: "搜索与快捷操作" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  await userEvent.click(within(navEl()!).getByRole("button", { name: /^设置/ }));
  expect((await screen.findByRole("tabpanel")).getAttribute("data-sec")).toBe("session");
});

it("keeps desktop navigation usable after closing settings without a top toggle", async () => {
  await open();
  await toggleSidebar();
  await userEvent.click(within(navEl()!).getByRole("button", { name: /^用量/ }));
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
  expect(app().dataset.rail).toBe("off");
  await userEvent.keyboard("{Escape}");
  await toggleSidebar();
  expect(app().dataset.rail).toBe("on");
});

it("declares the narrow drawer toggle after the shell's drag regions", async () => {
  room(390);
  await open();
  const toggle = document.querySelector<HTMLElement>(".studio-menu")!;
  expect(toggle).not.toBeNull();
  for (const sel of [".chrome", ".rail"]) {
    const region = document.querySelector<HTMLElement>(sel)!;
    expect(region, sel).not.toBeNull();
    expect(region.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING, `${sel} must come before the toggle`).toBeTruthy();
  }
});

it("uses only the divider to collapse and reopen the desktop sidebar", async () => {
  await open();
  const toggles = screen.queryAllByRole("button", { name: /收起工作区栏|展开工作区栏/ }).filter((b) => b.tabIndex !== -1);
  expect(toggles).toHaveLength(0);
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
  expect(document.querySelector(".studio-navlist") ?? document.querySelector(".nav")).toBeTruthy();
  await toggleSidebar();
  expect(app().dataset.rail).toBe("off");
  expect(screen.getByRole("separator", { name: "调整工作区栏宽度" }).getAttribute("aria-valuenow")).toBe("0");
  await toggleSidebar();
  expect(app().dataset.rail).toBe("on");
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
});

it("remembers divider width through collapse, reopen, and reload with the icon rail off", async () => {
  localStorage.setItem(KEY, "off");
  const first = await open();
  const divider = screen.getByRole("separator", { name: "调整工作区栏宽度" });
  divider.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(divider.getAttribute("aria-valuenow")).toBe("276");
  expect(localStorage.getItem("rx-rail-w")).toBe("276");
  await userEvent.keyboard("{Enter}");
  expect(app().dataset.rail).toBe("off");
  await userEvent.keyboard(" ");
  expect(app().dataset.rail).toBe("on");
  expect(divider.getAttribute("aria-valuenow")).toBe("276");
  first.view.unmount();
  await open();
  expect(screen.getByRole("separator", { name: "调整工作区栏宽度" }).getAttribute("aria-valuenow")).toBe("276");
});

it.each(["on", "off"])("keeps one drawer entry at the scene boundary with the icon rail %s", async (mode) => {
  localStorage.setItem(KEY, mode);
  await open();
  act(() => room(641));
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
  act(() => room(640));
  const toggle = await screen.findByRole("button", { name: "展开工作区栏" });
  expect(document.querySelectorAll(".studio-menu")).toHaveLength(1);
  await userEvent.click(toggle);
  expect(app().dataset.rail).toBe("on");
  expect(toggle.getAttribute("aria-label")).toBe("收起工作区栏");
  await userEvent.click(toggle);
  expect(app().dataset.rail).toBe("off");
  act(() => room(390));
  await userEvent.click(screen.getByRole("button", { name: "会话列表" }));
  expect(app().dataset.rail).toBe("on");
  act(() => room(1440));
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
  expect(app().dataset.rail).toBe("on");
  await toggleSidebar();
  act(() => room(390));
  act(() => room(1440));
  expect(app().dataset.rail).toBe("off");
  expect(document.querySelector(".studio-menu") !== null).toBe(app().dataset.rail === "off");
});

it("with the rail off the sidebar keeps its own quick entries", async () => {
  localStorage.setItem(KEY, "off");
  await open();
  expect(document.querySelector(".studio-navlist")).not.toBeNull();
});

it("collapses and reopens the sidebar from Ctrl+B, and a collapsed sidebar is reopened by an icon that names the shortcut", async () => {
  await open();
  expect(app().dataset.rail).toBe("on");
  await toggleSidebar();
  expect(app().dataset.rail).toBe("off");
  const icon = document.querySelector<HTMLElement>(".studio-menu")!;
  expect(icon.getAttribute("title")).toMatch(/Ctrl B$/);
  await userEvent.click(icon);
  expect(app().dataset.rail).toBe("on");
  expect(document.querySelector(".studio-menu")).toBeNull();
});

it("draws no handle on the dividers", async () => {
  await open();
  expect(document.querySelector(".gutter .grip")).toBeNull();
});
