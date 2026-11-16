// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "../testkit";
import { Transcript } from "../Transcript";
import { revealNested } from "./nestreveal";
import type { Item } from "../../state/session";

afterEach(cleanup);

const noop = async () => undefined as never;
const same = { entering: [] as string[], onEntered: () => {}, waiting: {}, scroll: { current: null }, onExtInvoke: () => {}, checkpoints: new Map(), onOpenProject: () => {}, onKeepHere: () => {}, takeovers: {} };
const view = (items: Item[], extra: Record<string, unknown> = {}) => (
  <Transcript items={items} {...same} revision={items.length} hidden={false} focus={null} onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
    onExtSubmit={noop} onPrepareRewind={noop} onCommitRewind={noop} onPrepareFileRevert={noop} onCommitFileRevert={noop} {...extra} />
);
const longOut = "alpha line\n".repeat(120) + "needle-in-the-child\n";
const child = (id: string) => ({ id, name: "bash", args: "{}", output: id === "k2" ? longOut : "ok", readOnly: false, parentId: "t1" }) as never;
const agent = (running: boolean): Item => ({
  t: "tool", id: "t1", running, children: [child("k1"), child("k2")],
  tool: { id: "t1", name: "task", args: JSON.stringify({ description: "审查" }), output: "report", readOnly: false } as never,
});
const card = () => document.querySelector<HTMLDetailsElement>('[data-call="t1"] details.tool-disclosure')!;
const kids = () => document.querySelectorAll('[data-call="k1"], [data-call="k2"]').length;
const open = () => { act(() => { card().open = true; card().dispatchEvent(new Event("toggle")); }); };

describe("the child calls of a sub-agent card", () => {
  it("are not mounted while a finished card is closed, and the header says what is inside once it opens", () => {
    render(view([agent(false)]));
    expect(card().open).toBe(false);
    expect(kids()).toBe(0);
    expect(document.querySelector(".nest-hd")).toBeNull();
    expect(document.querySelector(".nest-ret")).toBeNull();
    open();
    expect(document.querySelector(".nest-hd .who")?.textContent).toContain("2");
  });

  it("appear, whole, when the card is opened", () => {
    render(view([agent(false)]));
    open();
    expect(kids()).toBe(2);
    expect(document.querySelector(".nest-ret")?.textContent).toBe("report");
    expect(screen.getAllByRole("button", { name: /显示全部/ })).toHaveLength(1);
  });

  it("stay mounted, with what the reader did in them, when the card is closed again", () => {
    render(view([agent(false)]));
    open();
    fireEvent.click(screen.getByRole("button", { name: /显示全部/ }));
    expect(screen.getByRole("button", { name: /收起/ })).toBeTruthy();
    act(() => { card().open = false; card().dispatchEvent(new Event("toggle")); });
    expect(kids()).toBe(2);
    open();
    expect(screen.getByRole("button", { name: /收起/ })).toBeTruthy();
  });

  it("are mounted for a sub-agent that is still running, so its work stays live", () => {
    render(view([agent(true)]));
    expect(kids()).toBe(2);
  });

  it("are brought up by a jump to one of them, which opens the card that holds it", () => {
    render(view([agent(false)]));
    expect(kids()).toBe(0);
    act(() => revealNested("k2"));
    act(() => { card().dispatchEvent(new Event("toggle")); });
    expect(card().open).toBe(true);
    expect(document.querySelector('[data-call="k2"]')).not.toBeNull();
  });

  it("are brought up by a find hit inside one of them", () => {
    render(view([agent(false)], { find: { id: "t1", nth: 0, n: 1 }, query: "needle-in-the-child" }));
    expect(card().open).toBe(true);
    act(() => { card().dispatchEvent(new Event("toggle")); });
    expect(document.querySelector('[data-call="k2"]')).not.toBeNull();
  });

  it("do not reappear as new motion when the transcript is drawn again", () => {
    const { rerender } = render(view([agent(false)]));
    open();
    rerender(view([agent(false)]));
    expect(card().open).toBe(true);
    expect(kids()).toBe(2);
  });
});

describe("a find landing that is still settling when the transcript goes away", () => {
  it("does nothing further once its row has left the document", () => {
    const queued: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { queued.push(cb); return queued.length; });
    const style = vi.spyOn(window, "getComputedStyle");
    const { unmount } = render(view([agent(false)], { find: { id: "t1", nth: 0, n: 1 }, query: "needle-in-the-child" }));
    act(() => { card().dispatchEvent(new Event("toggle")); });
    unmount();
    style.mockClear();
    raf.mockClear();
    const pending = queued.splice(0);
    for (const cb of pending) cb(0);
    expect(style).not.toHaveBeenCalled();
    expect(queued).toHaveLength(0);
  });
});
