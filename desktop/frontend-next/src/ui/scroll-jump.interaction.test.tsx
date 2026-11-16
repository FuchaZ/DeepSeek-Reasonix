// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "./testkit";
import { Transcript } from "./Transcript";
import type { Item } from "../state/session";

afterEach(cleanup);

const items: Item[] = [{ t: "user", id: "i1", text: "hi" }];

function draw() {
  const noop = async () => undefined as never;
  const scroll = { current: null as HTMLDivElement | null };
  render(
    <Transcript
      items={items} entering={[]} onEntered={vi.fn()} revision={1} waiting={{}} scroll={scroll} hidden={false} focus={null}
      onApprove={noop} onFullAccess={noop} onPlan={noop} onAnswer={noop} onForget={noop}
      onExtInvoke={() => {}} onExtSubmit={noop} checkpoints={new Map()} onPrepareRewind={noop} onCommitRewind={noop}
      onPrepareFileRevert={noop} onCommitFileRevert={noop}
    />,
  );
  const root = scroll.current!;
  const geometry = { top: 0, client: 600, height: 5000 };
  Object.defineProperties(root, {
    scrollTop: { configurable: true, get: () => geometry.top, set: (v: number) => { geometry.top = v; } },
    clientHeight: { configurable: true, get: () => geometry.client },
    scrollHeight: { configurable: true, get: () => geometry.height },
  });
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600, x: 0, y: 0, toJSON() {} });
  const settle = async () => { await act(async () => { fireEvent.scroll(root); await new Promise((r) => requestAnimationFrame(() => r(null))); }); };
  const expanded = (kind: "tool-disclosure" | "think", at: number) => {
    const el = document.createElement("details");
    el.className = kind;
    el.open = true;
    el.getBoundingClientRect = () => ({ top: at - geometry.top, bottom: at - geometry.top + 80, left: 0, right: 400, width: 400, height: 80, x: 0, y: at, toJSON() {} });
    root.appendChild(el);
  };
  return { geometry, settle, expanded };
}

const up = () => screen.queryByRole("button", { name: "回到会话顶部" });
const down = () => screen.queryByRole("button", { name: "跳到最新" });

describe("the transcript's jump buttons", () => {
  it("offers neither when nothing scrolls", async () => {
    const { geometry, settle } = draw();
    geometry.height = 600;
    await settle();
    expect(up()).toBeNull();
    expect(down()).toBeNull();
  });

  it("offers each end only while that end is out of reach, and drops it on arriving", async () => {
    const { geometry, settle } = draw();
    await settle();
    expect(down()).not.toBeNull();
    expect(up()).toBeNull();

    geometry.top = 1200;
    await settle();
    expect(up()).not.toBeNull();
    expect(down()).not.toBeNull();

    geometry.top = 5000 - 600 - 20;
    await settle();
    expect(up()).not.toBeNull();
    expect(down()).toBeNull();
  });

  it("goes straight to the end the button names, past any expanded block", async () => {
    const { geometry, settle, expanded } = draw();
    expanded("tool-disclosure", 1900);
    expanded("think", 2700);
    geometry.top = 1000;
    await settle();
    fireEvent.click(down()!);
    expect(geometry.top).toBe(5000);
    geometry.top = 3000;
    await settle();
    fireEvent.click(up()!);
    expect(geometry.top).toBe(0);
  });

  it("steps to the nearest expanded call or thought when Shift is held", async () => {
    const { geometry, settle, expanded } = draw();
    expanded("tool-disclosure", 1900);
    expanded("think", 2700);
    geometry.top = 1000;
    await settle();

    fireEvent.click(down()!, { shiftKey: true });
    expect(geometry.top).toBe(1900 - 8);
    await settle();

    fireEvent.click(down()!, { shiftKey: true });
    expect(geometry.top).toBe(2700 - 8);
    await settle();

    fireEvent.click(up()!, { shiftKey: true });
    expect(geometry.top).toBe(1900 - 8);
  });

  it("goes to the very start or end when nothing is expanded that way", async () => {
    const { geometry, settle } = draw();
    geometry.top = 1200;
    await settle();
    fireEvent.click(up()!);
    expect(geometry.top).toBe(0);

    geometry.top = 1200;
    await settle();
    fireEvent.click(down()!);
    expect(geometry.top).toBe(5000);
  });
});
