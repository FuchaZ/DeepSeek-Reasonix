// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { PeerDispatch } from "./PeerDispatch";
import { MockPort } from "../port/mock";
import { boot, STORAGE } from "../i18n";
import type { AgentPort, PeersSettings } from "../port/port";
import type { TreeWorkspace } from "../port/hub";
import type { PeersSettingsStore } from "./usePeersSettings";

beforeEach(() => {
  localStorage.setItem(STORAGE, "zh");
  boot();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = (over: Partial<PeersSettings> = {}): PeersSettings => ({
  enabled: true, dispatch: true, release_projects: [], max_dispatch_depth: 1, max_dispatched_sessions: 8, open_nested: false, incoming: "dispatch", cross_project: "always", path: "/home/me/.reasonix/config.toml", applies: "next_turn", pending: false, available: true, ...over,
});

const ws = (name: string, root: string): TreeWorkspace => ({ root, name, remembered: true, sessions: [] });
const projects = [ws("alpha", "/w/alpha"), ws("beta", "/w/beta")];

function draw(initial: PeersSettings = settings(), tree: TreeWorkspace[] = projects) {
  const port = new MockPort();
  vi.spyOn(port, "peersSettings").mockResolvedValue(initial);
  const start = vi.spyOn(port, "dispatchToProject");
  const hub = { tree: vi.fn(async () => tree) };
  const store: PeersSettingsStore = { state: initial, loadError: "", publish: () => {} };
  render(<PeerDispatch port={port as unknown as AgentPort} hub={hub} settings={store} />);
  return { start, port };
}

describe("handing a task over yourself", () => {
  it("starts the dispatch the person asked for, with no card of its own", async () => {
    const { start } = draw();
    const task = await screen.findByLabelText("交给它的任务");
    await userEvent.type(task, "run the tests");
    await userEvent.click(screen.getByRole("button", { name: "派过去" }));
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("/w/alpha", "run the tests", undefined));
  });

  it("carries the role when one is named, and says which project it landed in", async () => {
    const { start } = draw();
    await userEvent.type(await screen.findByLabelText("交给它的任务"), "gate the build");
    await userEvent.type(screen.getByLabelText("角色（可选）"), "reviewer");
    await userEvent.click(screen.getByRole("button", { name: "派过去" }));
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("/w/alpha", "gate the build", "reviewer"));
    expect((await screen.findByRole("status")).textContent).toContain("alpha");
  });

  it("sends to the project the person picked, not the first one", async () => {
    const { start } = draw();
    await userEvent.selectOptions(await screen.findByLabelText("派到哪个项目"), "/w/beta");
    await userEvent.type(screen.getByLabelText("交给它的任务"), "lint it");
    await userEvent.click(screen.getByRole("button", { name: "派过去" }));
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith("/w/beta", "lint it", undefined));
  });

  it("cannot start with no task written", async () => {
    const { start } = draw();
    const button = await screen.findByRole("button", { name: "派过去" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(button);
    expect(start).not.toHaveBeenCalled();
  });

  it("stays inert until messages between sessions are on", async () => {
    draw(settings({ enabled: false }));
    expect(await screen.findByText(/会话间消息关着/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "派过去" })).toBeNull();
  });

  it("says what went wrong rather than failing silently", async () => {
    const { start, port } = draw();
    vi.spyOn(port, "peersSettings").mockResolvedValue(settings());
    start.mockRejectedValue(new Error("no project of yours answers to that name"));
    await userEvent.type(await screen.findByLabelText("交给它的任务"), "x");
    await userEvent.click(screen.getByRole("button", { name: "派过去" }));
    expect((await screen.findByRole("alert")).textContent).toContain("no project of yours answers to that name");
  });

  it("says there is nowhere to hand a task when no project is remembered", async () => {
    draw(settings(), []);
    expect(await screen.findByText(/没有可以放行的项目/)).toBeTruthy();
  });
});
