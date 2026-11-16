// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { PeersChatPage } from "./PeersChatPage";
import type { useRuntimeReload } from "./RuntimeReload";
import { MockPort } from "../port/mock";
import { boot, STORAGE } from "../i18n";
import type { AgentPort, PeersSettings } from "../port/port";

beforeEach(() => {
  localStorage.setItem(STORAGE, "zh");
  boot();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const settings = (over: Partial<PeersSettings> = {}): PeersSettings => ({
  enabled: false, dispatch: false, release_projects: [], max_dispatch_depth: 1, max_dispatched_sessions: 8, open_nested: false, incoming: "dispatch", cross_project: "always", path: "/home/me/.reasonix/config.toml", applies: "next_turn", pending: false, available: true, ...over,
});

const ref = { tokens: 8000, defaultTokens: 8000, minTokens: 500, maxTokens: 200000, path: "/u/config.toml" };

// The reload control is the pane's one instance, handed down as a prop; the page
// only draws it, so a stub that looks like it is what the page can be held to.
const reload: ReturnType<typeof useRuntimeReload> = {
  state: "",
  applied: () => {},
  report: () => {},
  action: <button type="button" data-action="extensions.reload">重载运行时</button>,
  note: null,
};

function draw(initial: PeersSettings = settings()) {
  const port = new MockPort();
  let current = initial;
  vi.spyOn(port, "peersSettings").mockImplementation(async () => current);
  const save = vi.spyOn(port, "savePeersSettings").mockImplementation(async (edit) => {
    current = {
      ...current,
      enabled: edit.enabled ?? current.enabled,
      dispatch: edit.dispatch ?? current.dispatch,
      open_nested: edit.open_nested ?? current.open_nested,
      incoming: edit.incoming ?? current.incoming,
      max_dispatch_depth: edit.max_dispatch_depth ?? current.max_dispatch_depth,
      max_dispatched_sessions: edit.max_dispatched_sessions ?? current.max_dispatched_sessions,
      pending: true,
    };
    return current;
  });
  vi.spyOn(port, "sessionRefSettings").mockResolvedValue(ref);
  vi.spyOn(port, "saveSessionRefSettings").mockImplementation(async (n) => ({ ...ref, tokens: n }));
  vi.spyOn(port, "subagentClaims").mockResolvedValue({ optimistic: true, path: "/u/config.toml" });
  vi.spyOn(port, "saveSubagentClaims").mockImplementation(async (optimistic) => ({ optimistic, path: "/u/config.toml" }));
  const hub = { tree: vi.fn(async () => []) };
  render(<PeersChatPage port={port as unknown as AgentPort} hub={hub} onChanged={() => {}} reload={reload} />);
  return { save };
}

describe("the session cross-chat page", () => {
  it("draws the messages block, the two dispatch ceilings, the collaboration card and the runtime reload foot", async () => {
    draw();
    expect([...document.querySelectorAll(".prefs-card > header h3")].map((h) => h.textContent)).toEqual(["会话互聊", "协作"]);
    for (const id of ["peers", "peer-projects", "peers-dispatch-depth", "peers-dispatched-sessions", "session-ref", "subagent-claims"]) {
      await waitFor(() => expect(document.querySelector(`[data-setting="${id}"]`), id).toBeTruthy());
    }
    expect((await screen.findByRole("textbox", { name: "派发穿透层数" }) as HTMLInputElement).value).toBe("1");
    expect((screen.getByRole("textbox", { name: "同时派发的会话上限" }) as HTMLInputElement).value).toBe("8");
    expect(document.querySelector('[data-action="extensions.reload"]')).toBeTruthy();
  });

  it("keeps the master switch in charge here as anywhere: the hand-off stays inert until messages are on", async () => {
    const { save } = draw();
    const dispatch = await screen.findByRole("switch", { name: "允许模型把任务交给别的会话" });
   expect((dispatch as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(dispatch);
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("switch", { name: "启用会话间消息" }));
    expect(save).toHaveBeenCalledExactlyOnceWith({ enabled: true });
    await waitFor(() => expect(screen.getByRole("switch", { name: "启用会话间消息" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("saves each dispatch ceiling through the switches file, on its own", async () => {
    const { save } = draw(settings({ enabled: true }));
    const depth = await screen.findByRole("textbox", { name: "派发穿透层数" });
    await userEvent.clear(depth);
    await userEvent.type(depth, "3{Enter}");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ max_dispatch_depth: 3 }));
    const sessions = screen.getByRole("textbox", { name: "同时派发的会话上限" });
    await userEvent.clear(sessions);
    await userEvent.type(sessions, "12{Enter}");
    await waitFor(() => expect(save).toHaveBeenLastCalledWith({ max_dispatched_sessions: 12 }));
    await waitFor(() => expect((screen.getByRole("textbox", { name: "派发穿透层数" }) as HTMLInputElement).value).toBe("3"));
  });

  it("refuses a ceiling that is not a whole number of 0 or more, without writing", async () => {
    const { save } = draw(settings({ enabled: true }));
    const depth = await screen.findByRole("textbox", { name: "派发穿透层数" });
    await userEvent.clear(depth);
    await userEvent.type(depth, "{Enter}");
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("请输入一个不小于 0 的整数。")).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "派发穿透层数" }) as HTMLInputElement).value).toBe("");
  });
});
