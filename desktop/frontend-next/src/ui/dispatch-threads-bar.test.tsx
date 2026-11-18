// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import type { DispatchBoardRow } from "../port/hub";
import { DispatchThreadsBar } from "./DispatchThreadsBar";

afterEach(cleanup);

const row = (over: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
  dispatcher: { key: "s-lead", sessionPath: "/sessions/lead.jsonl", title: "领头会话", project: "/w/alpha" },
  assignee: { key: "s-member", sessionPath: "/sessions/member.jsonl", title: "组员A", project: "/w/beta" },
  role: "研究员",
  state: "waiting",
  since: "2026-11-18T10:00:00Z",
  crossProject: true,
  ...over,
});

/** A window whose board answers with rows and whose tree can be told to change. */
function hubWith(rows: DispatchBoardRow[]) {
  const listeners: Array<() => void> = [];
  const hub = {
    dispatchBoard: vi.fn().mockResolvedValue(rows),
    onTreeChanged: vi.fn((fn: () => void) => { listeners.push(fn); return () => {}; }),
    change: () => { for (const fn of listeners) fn(); },
  };
  return hub;
}

function draw(rows: DispatchBoardRow[], onOpen = vi.fn()) {
  const hub = hubWith(rows);
  const view = render(<DispatchThreadsBar hub={hub} onOpen={onOpen} />);
  return { onOpen, hub, container: view.container };
}

describe("the collaboration chip", () => {
  it("draws nothing while the board lists no dispatch", async () => {
    // The board is the authority, and it drops archived and removed ends. A
    // sender's own record outlives both, so letting it stand in for an empty
    // board is what kept a deleted conversation on the chip.
    const { container, hub } = draw([]);
    await waitFor(() => expect(hub.dispatchBoard).toHaveBeenCalled());
    expect(container.children).toHaveLength(0);
  });

  it("draws nothing while the window holds no board route", () => {
    const { container } = render(<DispatchThreadsBar onOpen={vi.fn()} />);
    expect(container.children).toHaveLength(0);
  });

  it("drops the chip when the tree change leaves nothing on the board", async () => {
    const hub = hubWith([row()]);
    const { container } = render(<DispatchThreadsBar hub={hub} onOpen={vi.fn()} />);
    expect(await screen.findByText("组员A")).toBeTruthy();

    hub.dispatchBoard.mockResolvedValue([]);
    hub.change();
    await waitFor(() => expect(container.children).toHaveLength(0));
  });
});

describe("the collaboration board behind the chip", () => {
  it("names both ends and says where the task stands", async () => {
    const { hub } = draw([row()]);
    expect(await screen.findByText("组员A")).toBeTruthy();
    expect(screen.getByText("领头会话")).toBeTruthy();
    expect(screen.getByText("研究员")).toBeTruthy();
    expect(screen.getByText("等待接收")).toBeTruthy();
    expect(hub.dispatchBoard).toHaveBeenCalled();
    // One dispatch, one row: the sender's own record is never drawn beside it.
    expect(screen.queryByText(/处理『/)).toBeNull();
  });

  it("splits the cross-project rows from the ones in this project", async () => {
    draw([row(), row({ crossProject: false, role: "本组", assignee: { key: "s-b", sessionPath: "/sessions/b.jsonl", title: "组员B" } })]);
    expect(await screen.findByText("跨项目")).toBeTruthy();
    expect(screen.getByText("本项目")).toBeTruthy();
  });

  it("opens either end's session from its name", async () => {
    const { onOpen } = draw([row()]);
    await userEvent.click(await screen.findByText("组员A"));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("/sessions/member.jsonl");
  });

  it("waits for an answer before asking the board again", async () => {
    vi.useFakeTimers();
    try {
      const answers: Array<(rows: DispatchBoardRow[]) => void> = [];
      const hub = {
        dispatchBoard: vi.fn(() => new Promise<DispatchBoardRow[]>((resolve) => { answers.push(resolve); })),
        onTreeChanged: vi.fn(() => () => {}),
      };
      render(<DispatchThreadsBar hub={hub} />);
      expect(hub.dispatchBoard).toHaveBeenCalledTimes(1);
      // Two poll intervals pass with the host still silent: a slow board must
      // not collect a second request behind the first.
      await vi.advanceTimersByTimeAsync(8000);
      expect(hub.dispatchBoard).toHaveBeenCalledTimes(1);
      answers[0]([]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(hub.dispatchBoard).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
