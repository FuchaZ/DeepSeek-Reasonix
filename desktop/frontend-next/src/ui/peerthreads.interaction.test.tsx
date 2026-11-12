// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { MockPort } from "../port/mock";
import type { PeerThread, PeerThreadState } from "../port/boundary";
import { PeerThreadMark, PeerThreadsProvider } from "./peerthreads";

afterEach(cleanup);

const thread = (state: PeerThreadState, over: Partial<PeerThread> = {}): PeerThread => ({
  key: "peer-1",
  title: "Docs session",
  project: "site",
  sessionPath: "/sessions/docs.jsonl",
  state,
  since: "2026-10-16T10:00:00Z",
  messageId: "m1",
  ...over,
});

function portWith(threads: PeerThread[]) {
  const port = new MockPort();
  vi.spyOn(port, "peers").mockResolvedValue({ enabled: true, peers: [], held: [], threads });
  return port;
}

function draw(port: MockPort, onOpen = vi.fn(), listeners: { fire: () => void } = { fire: () => {} }) {
  const hub = { onTreeChanged: (l: () => void) => { listeners.fire = l; return () => {}; } };
  render(
    <PeerThreadsProvider port={port} hub={hub} onOpen={onOpen}>
      <PeerThreadMark path="/sessions/docs.jsonl" />
      <PeerThreadMark path="/sessions/other.jsonl" />
    </PeerThreadsProvider>,
  );
  return { onOpen, listeners };
}

describe("a dispatch indicator on the peer's session", () => {
  it.each<[PeerThreadState, RegExp]>([
    ["waiting", /等对方的用户批准/],
    ["working", /已放行/],
    ["replied", /回复了你/],
    ["declined", /拒绝了你/],
  ])("says %s with the peer's title and project", async (state, words) => {
    draw(portWith([thread(state)]));
    const mark = await screen.findByRole("button", { name: words });
    expect(mark.getAttribute("data-state")).toBe(state);
    expect(mark.getAttribute("title")).toMatch(/Docs session/);
    expect(mark.getAttribute("title")).toMatch(/site/);
  });

  it("marks the state with a lamp rather than an icon, so the row reads at a glance", async () => {
    draw(portWith([thread("working")]));
    const mark = await screen.findByRole("button", { name: /已放行/ });
    const lamp = mark.querySelector(".peerthread-lamp");
    expect(lamp).not.toBeNull();
    // The lamp carries the state on the element itself: the stylesheet keys off
    // these two attributes, and a renamed class would leave a bare dot.
    expect(lamp?.tagName).toBe("I");
    expect(lamp?.getAttribute("aria-hidden")).toBe("true");
  });

  it("draws nothing on a session that was never written to", async () => {
    draw(portWith([thread("replied")]));
    await screen.findByRole("button", { name: /回复了你/ });
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("draws nothing while the kernel lists no threads", async () => {
    const port = portWith([]);
    draw(port);
    await waitFor(() => expect(port.peers).toHaveBeenCalled());
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("jumps to the peer's session when clicked, and only that", async () => {
    const { onOpen } = draw(portWith([thread("replied")]));
    await userEvent.click(await screen.findByRole("button", { name: /回复了你/ }));
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("/sessions/docs.jsonl");
  });

  it("does not let the click reach the row it sits in", async () => {
    const rowClick = vi.fn();
    const port = portWith([thread("working")]);
    render(
      <PeerThreadsProvider port={port} hub={{}} onOpen={() => {}}>
        <div onClick={rowClick}><PeerThreadMark path="/sessions/docs.jsonl" /></div>
      </PeerThreadsProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: /已放行/ }));
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("reads /peers again when the tree changes, and follows the new state", async () => {
    const port = portWith([thread("waiting")]);
    const { listeners } = draw(port);
    await screen.findByRole("button", { name: /等对方的用户批准/ });
    vi.spyOn(port, "peers").mockResolvedValue({ enabled: true, peers: [], held: [], threads: [thread("replied")] });
    act(() => listeners.fire());
    expect(await screen.findByRole("button", { name: /回复了你/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /等对方的用户批准/ })).toBeNull();
  });
});
