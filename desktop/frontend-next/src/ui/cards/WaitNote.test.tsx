// @vitest-environment jsdom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

  // A bash row leaves the command out: it is the call's payload rather than
  // what it touched, and a heredoc clipped at 96 characters read as half a
  // sentence. The whole command stays one press away in the body.
  it("leaves the command off the row and keeps it in the body", () => {
    const long = "cd /a/very/long/path && for f in *.md; do wc -l \"$f\"; done; find . -maxdepth 3";
    const { container } = render(<ToolCard tool={bash({ args: JSON.stringify({ command: long }) })} running activity />);
    expect(container.querySelector(".hl .arg")).toBeNull();
    open(container);
    expect(container.querySelector(".activity-call-input")?.textContent).toContain("maxdepth 3");
  });

  // Only the command key is skipped. Every other argument keeps its place, so a
  // call that opened a file still names it on the row.
  it("keeps a path on the row", () => {
    const shot = "data:image/png;base64,AAAA";
    const tool = { id: "vi", name: "view_image", readOnly: true, args: '{"path":"shots/w280.png"}',
      output: "[image: shots/w280.png, image/png, 567729 bytes shown]", images: [shot] } as Parameters<typeof ToolCard>[0]["tool"];
    const { container: row } = render(<ToolCard tool={tool} running={false} activity />);
    expect(row.querySelector(".hl .arg")?.textContent).toBe("shots/w280.png");
    expect(row.querySelector(".hl .nm")?.textContent).toContain("查看");
    cleanup();
    render(<ToolCard tool={tool} running={false} />);
    expect(screen.getByRole("button", { name: "查看图片 shots/w280.png" })).toBeTruthy();
  });
});
