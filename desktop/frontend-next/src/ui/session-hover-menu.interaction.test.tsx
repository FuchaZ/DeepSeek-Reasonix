// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeSession, TreeWorkspace } from "../port/hub";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sessions: TreeSession[] = [
  { path: "/w/.reasonix/sessions/a.jsonl", name: "a", title: "Alpha", lastActiveAt: 1 },
  { path: "/w/.reasonix/sessions/b.jsonl", name: "b", title: "Beta", lastActiveAt: 2 },
];

function draw() {
  const tree: TreeWorkspace[] = [{ root: "/w", name: "w", sessions }];
  render(<Workspaces
    hub={{ dispatchThreads: vi.fn().mockResolvedValue([]) } as never}
    tree={tree} treeRead runtimes={[]} active="" folded={new Set()} onFold={() => {}}
    reload={async () => {}} onOpen={async () => {}} onFocus={() => {}} onClose={async () => {}}
    liveIds={() => []} runs={{}} onRename={() => {}} onError={() => {}}
    adder={{ add: () => {}, close: () => {}, at: null } as never}
  />);
}

const row = (title: string) => screen.getByRole("treeitem", { name: new RegExp(title) });
const settle = () => act(async () => { vi.advanceTimersByTime(450); });

it("dismisses a settled hover card when the row's menu opens", async () => {
  vi.useFakeTimers();
  draw();
  fireEvent.mouseEnter(row("Alpha"));
  await settle();
  expect(screen.getByRole("dialog", { name: "Alpha" })).toBeTruthy();

  fireEvent.contextMenu(row("Alpha"), { clientX: 120, clientY: 90 });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("menu", { name: "会话操作" })).toBeTruthy();
});

it("keeps every row's card away while a menu is open, and gives it back after", async () => {
  vi.useFakeTimers();
  draw();
  fireEvent.contextMenu(row("Alpha"), { clientX: 120, clientY: 90 });
  expect(screen.getByRole("menu", { name: "会话操作" })).toBeTruthy();

  fireEvent.mouseEnter(row("Beta"));
  await settle();
  expect(screen.queryByRole("dialog")).toBeNull();

  act(() => { fireEvent.keyDown(window, { key: "Escape" }); });
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.mouseEnter(row("Beta"));
  await settle();
  expect(screen.getByRole("dialog", { name: "Beta" })).toBeTruthy();
});
