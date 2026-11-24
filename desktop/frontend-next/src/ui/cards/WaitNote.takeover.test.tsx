// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "../testkit";
import { ToolCard } from "./ToolCard";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const bash = (id: string) => ({ id, name: "bash", args: JSON.stringify({ command: "sleep 600" }), readOnly: false }) as Parameters<typeof ToolCard>[0]["tool"];
const note = (c: HTMLElement) => c.querySelector(".activity-call-wait");
const open = (c: HTMLElement) => {
  const d = c.querySelector("details")!;
  d.open = true;
  act(() => { d.dispatchEvent(new Event("toggle")); });
};

// A session switch rebinds the pane through a new key, which unmounts the whole
// transcript and draws it again. The call did not restart, so neither may its
// reading: the window has been watching it since it first saw it running.
describe("a call the window has been watching", () => {
  it("keeps counting when the pane is drawn again for a switch", () => {
    const first = render(<ToolCard tool={bash("call_switch")} running activity />);
    open(first.container);
    act(() => vi.advanceTimersByTime(5000));
    expect(note(first.container)?.textContent).toMatch(/已运行 5/);
    first.unmount();

    const again = render(<ToolCard tool={bash("call_switch")} running activity />);
    open(again.container);
    expect(note(again.container)?.textContent).toMatch(/已运行 5/);
    act(() => vi.advanceTimersByTime(2000));
    expect(note(again.container)?.textContent).toMatch(/已运行 7/);
  });

  // The same reading decides when a lone call offers its stop button, so a
  // remount used to take that away for ten more seconds.
  it("still offers to stop it after the pane is drawn again", () => {
    const onStop = vi.fn();
    const first = render(<ToolCard tool={bash("call_stop")} running onStop={onStop} />);
    act(() => vi.advanceTimersByTime(11_000));
    expect(first.container.querySelector(".stop-call")).not.toBeNull();
    first.unmount();

    const again = render(<ToolCard tool={bash("call_stop")} running onStop={onStop} />);
    expect(again.container.querySelector(".stop-call")).not.toBeNull();
  });

  // Two calls running at once are two readings, not one shared clock.
  it("counts each call from its own start", () => {
    const first = render(<ToolCard tool={bash("call_a")} running activity />);
    open(first.container);
    act(() => vi.advanceTimersByTime(3000));
    const second = render(<ToolCard tool={bash("call_b")} running activity />);
    open(second.container);
    act(() => vi.advanceTimersByTime(2000));
    expect(note(first.container)?.textContent).toMatch(/已运行 5/);
    expect(note(second.container)?.textContent).toMatch(/已运行 2/);
  });
});
