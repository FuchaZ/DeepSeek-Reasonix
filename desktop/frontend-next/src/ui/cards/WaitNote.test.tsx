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

const bash = (over: Record<string, unknown> = {}) => ({ id: "b1", name: "bash", args: JSON.stringify({ command: "sleep 600" }), readOnly: false, ...over }) as Parameters<typeof ToolCard>[0]["tool"];
const note = (c: HTMLElement) => c.querySelector(".activity-call-wait");
const open = (c: HTMLElement) => {
  const d = c.querySelector("details")!;
  d.open = true;
  act(() => { d.dispatchEvent(new Event("toggle")); });
};

describe("a running call that has printed nothing", () => {
  it("says it is still running instead of sitting blank, and counts how long", () => {
    const { container } = render(<ToolCard tool={bash()} running activity />);
    open(container);
    expect(note(container)?.textContent).toContain("命令仍在运行");
    act(() => vi.advanceTimersByTime(5000));
    expect(note(container)?.textContent).toMatch(/已运行 5/);
  });

  it("names the timeout only when the command carries one", () => {
    const withLimit = render(<ToolCard tool={bash({ args: JSON.stringify({ command: "make", timeout_seconds: 300 }) })} running activity />);
    open(withLimit.container);
    expect(note(withLimit.container)?.textContent).toContain("超时上限 300 秒");
    cleanup();
    const without = render(<ToolCard tool={bash()} running activity />);
    open(without.container);
    expect(note(without.container)?.textContent).not.toContain("超时");
  });

  it("goes away once output arrives, and is not drawn for a finished call or outside the detail view", () => {
    const { container, rerender } = render(<ToolCard tool={bash()} running activity />);
    open(container);
    rerender(<ToolCard tool={bash({ output: "building…\n" })} running activity />);
    expect(note(container)).toBeNull();
    rerender(<ToolCard tool={bash({ output: "done", durationMs: 1200 })} running={false} activity />);
    expect(note(container)).toBeNull();
    rerender(<ToolCard tool={bash()} running />);
    expect(note(container)).toBeNull();
  });

  it("opens at all: a running call with no output yet used to be a row that did nothing", () => {
    const { container } = render(<ToolCard tool={bash()} running activity />);
    expect(container.querySelector("details.tool-disclosure")).not.toBeNull();
    expect(container.querySelector(".activity-call-input")).not.toBeNull();
    cleanup();
    expect(render(<ToolCard tool={bash()} running />).container.querySelector("details")).toBeNull();
  });

  // The row no longer carries the command — a 96-character clip of a heredoc
  // says less than "ran a command" does — so the whole of it is what the body
  // holds, one press away.
  it("keeps the whole command in the body the row opens", () => {
    const long = "cd /a/very/long/path && for f in *.md; do wc -l \"$f\"; done; find . -maxdepth 3";
    const { container } = render(<ToolCard tool={bash({ args: JSON.stringify({ command: long }) })} running activity />);
    expect(container.querySelector(".arg")).toBeNull();
    open(container);
    expect(container.querySelector(".activity-call-input")?.textContent).toContain("maxdepth 3");
  });
});
