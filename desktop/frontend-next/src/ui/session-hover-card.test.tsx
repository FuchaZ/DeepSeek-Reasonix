// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { SessionHoverCard } from "./SessionHoverCard";
import { boot, STORAGE } from "../i18n";
import type { DispatchThread, HubPort, TreeSession, TreeWorkspace } from "../port/hub";

beforeEach(() => {
  localStorage.setItem(STORAGE, "zh");
  boot();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ws: TreeWorkspace = { root: "/work/app", name: "app", sessions: [], total: 0, archived: 0, remaining: 0 };
const session: TreeSession = { path: "/work/app/s.jsonl", name: "s", title: "修一下登录", lastActiveAt: Date.now() };

const hubWith = (threads: DispatchThread[]) => ({ dispatchThreads: vi.fn().mockResolvedValue(threads) }) as unknown as HubPort;

const card = (hub: HubPort, onOpenSession = vi.fn()) =>
  render(
    <SessionHoverCard hub={hub} ws={ws} session={session} anchor={{ top: 10, right: 200 } as DOMRect}
      onClose={() => {}} onKeepOpen={() => {}} onOpenSession={onOpenSession} />,
  );

describe("the card a session row's hover opens", () => {
  it("lists what this session dispatched, by the role each was opened under", async () => {
    card(hubWith([{ role: "reviewer", sessionPath: "/work/app/r.jsonl", key: "k1" }]));
    await waitFor(() => expect(screen.getByText(/处理『reviewer』的回信/)).toBeTruthy());
  });

  it("opens the session a task landed on", async () => {
    const onOpenSession = vi.fn();
    card(hubWith([{ role: "dev", sessionPath: "/work/app/d.jsonl", key: "k2" }]), onOpenSession);
    const line = await screen.findByText(/处理『dev』的回信/);
    await userEvent.click(line);
    expect(onOpenSession).toHaveBeenCalledWith("/work/app/d.jsonl");
  });

  it("shows the conversation's own facts with no dispatch record", async () => {
    card(hubWith([]));
    await waitFor(() => expect(screen.getByText("修一下登录")).toBeTruthy());
    expect(screen.getByText("/work/app")).toBeTruthy();
    expect(screen.queryByText(/处理『/)).toBeNull();
  });
});
