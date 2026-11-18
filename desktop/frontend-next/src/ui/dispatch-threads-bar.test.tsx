// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { MockPort } from "../port/mock";
import type { PeerThread, PeerThreadState } from "../port/boundary";
import type { DispatchBoardRow } from "../port/hub";
import { DispatchThreadsBar } from "./DispatchThreadsBar";

afterEach(cleanup);

const thread = (state: PeerThreadState, over: Partial<PeerThread> = {}): PeerThread => ({
  key: "peer-1",
  title: "Docs session",
  role: "组员B · VR面板式",
  project: "site",
  sessionPath: "/sessions/docs.jsonl",
  state,
  since: "2026-10-16T10:00:00Z",
  messageId: "m1",
  ...over,
});

function portWith(threads: PeerThread[], enabled = true) {
  const port = new MockPort();
  vi.spyOn(port, "peers").mockResolvedValue({ enabled, peers: [], held: [], threads });
  return port;
}

function draw(port: MockPort, onOpen = vi.fn()) {
  const view = render(<DispatchThreadsBar port={port} onOpen={onOpen} />);
  return { onOpen, container: view.container };
}

describe("the dispatch status bar", () => {
  it.each<[PeerThreadState, RegExp]>([
    ["waiting", /等对方的用户批准/],
    ["working", /已放行/],
    ["replied", /回复了你/],
    ["declined", /拒绝了你/],
  ])("says %s of the session the task was dispatched to", async (state, words) => {
    draw(portWith([thread(state)]));
    expect(await screen.findByText(/处理『组员B · VR面板式』的回信/)).toBeTruthy();
    // The state copy is visible text beside the row, and the role the sender
    // opened the session under is the name shown, not the peer's own title.
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.queryByText(/Docs session/)).toBeNull();
  });

  it("falls back to the session's own title when no role was given", async () => {
    draw(portWith([thread("replied", { role: undefined })]));
    expect(await screen.findByText(/处理『Docs session』的回信/)).toBeTruthy();
    expect(screen.getByText(/回复了你/)).toBeTruthy();
  });

  it("opens the peer's session from the row, carrying the action and the path", async () => {
    const { onOpen } = draw(portWith([thread("replied")]));
    const open = await screen.findByRole("button", { name: /回复了你/ });
    expect(open.getAttribute("data-action")).toBe("peer.thread-open");
    expect(open.getAttribute("data-session-path")).toBe("/sessions/docs.jsonl");
    await userEvent.click(open);
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("/sessions/docs.jsonl");
  });

  it("shows one row per dispatched session, each with its own path", async () => {
    draw(portWith([thread("waiting"), thread("replied", { key: "peer-2", role: "评审", sessionPath: "/sessions/review.jsonl" })]));
    expect(await screen.findByText(/处理『组员B · VR面板式』的回信/)).toBeTruthy();
    expect(screen.getByText(/处理『评审』的回信/)).toBeTruthy();
    // One chip names the whole rail; the lamps inside its card are the rows.
    expect(screen.getByRole("button", { name: "会话互聊" })).toBeTruthy();
    const lamps = [...document.querySelectorAll<HTMLElement>(".peerthread")];
    expect(lamps).toHaveLength(2);
    expect(lamps[1].getAttribute("data-session-path")).toBe("/sessions/review.jsonl");
    expect(screen.getByText(/已派发 2 个会话/)).toBeTruthy();
  });

  it("says its own word for a peer the wire names neither role nor title for", async () => {
    // The audit trail carries keys only: a peer that went quiet before its
    // live beat expired keeps no name, and that must not read as "undefined".
    draw(portWith([thread("replied", { role: undefined, title: undefined, project: undefined })]));
    expect(await screen.findByText(/处理『已派发的会话』的回信/)).toBeTruthy();
    expect(screen.getByText(/（未知项目）回复了你/)).toBeTruthy();
  });

  it("names the card for the cross-chat it reports", async () => {
    draw(portWith([thread("waiting")]));
    expect(await screen.findByRole("dialog", { name: /会话互聊/ })).toBeTruthy();
  });

  it("draws nothing while the kernel lists no threads", async () => {
    const port = portWith([]);
    const { container } = draw(port);
    await waitFor(() => expect(port.peers).toHaveBeenCalled());
    expect(container.children).toHaveLength(0);
  });

  it("draws nothing while cross-chat is switched off, even with threads listed", async () => {
    const port = portWith([thread("replied")], false);
    const { container } = draw(port);
    await waitFor(() => expect(port.peers).toHaveBeenCalled());
    expect(container.children).toHaveLength(0);
  });
});

describe("the collaboration board behind the chip", () => {
  const row = (over: Partial<DispatchBoardRow> = {}): DispatchBoardRow => ({
    dispatcher: { key: "s-lead", sessionPath: "/sessions/lead.jsonl", title: "领头会话", project: "/w/alpha" },
    assignee: { key: "s-member", sessionPath: "/sessions/member.jsonl", title: "组员A", project: "/w/beta" },
    role: "研究员",
    state: "waiting",
    since: "2026-11-18T10:00:00Z",
    crossProject: true,
    ...over,
  });

  function drawWithBoard(rows: DispatchBoardRow[], onOpen = vi.fn()) {
    const port = portWith([thread("replied")]);
    const hub = { dispatchBoard: vi.fn().mockResolvedValue(rows) };
    const view = render(<DispatchThreadsBar port={port} hub={hub} onOpen={onOpen} />);
    return { onOpen, hub, container: view.container };
  }

  it("names both ends and says where the task stands", async () => {
    const { hub } = drawWithBoard([row()]);
    expect(await screen.findByText("组员A")).toBeTruthy();
    expect(screen.getByText("领头会话")).toBeTruthy();
    expect(screen.getByText("研究员")).toBeTruthy();
    expect(screen.getByText("等待接收")).toBeTruthy();
    expect(hub.dispatchBoard).toHaveBeenCalled();
    // The board is the authority once it answers, so the sender's own record
    // is not drawn beside it: one dispatch, one row.
    expect(screen.queryByText(/处理『/)).toBeNull();
  });

  it("splits the cross-project rows from the ones in this project", async () => {
    drawWithBoard([row(), row({ crossProject: false, role: "本组", assignee: { key: "s-b", sessionPath: "/sessions/b.jsonl", title: "组员B" } })]);
    expect(await screen.findByText("跨项目")).toBeTruthy();
    expect(screen.getByText("本项目")).toBeTruthy();
  });

  it("opens either end's session from its name", async () => {
    const { onOpen } = drawWithBoard([row()]);
    await userEvent.click(await screen.findByText("组员A"));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("/sessions/member.jsonl");
  });
});
