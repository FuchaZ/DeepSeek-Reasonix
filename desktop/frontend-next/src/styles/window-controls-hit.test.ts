import { describe, expect, it } from "vitest";
import dock from "./dock.css?raw";

// The docked workbench's strip shares the window bar with the Windows window
// controls. Where its slot ends is a hit-testing fact jsdom cannot answer;
// perf/window-controls-hit.mjs asks the browser, and this holds the rule's
// shape so the geometry cannot drift back without a red test.
const rule = dock.match(/\.app\[data-browser="on"\] \.chrome \.wb-dock-head:not\(:empty\)\s*\{([^}]*)\}/);

describe("the docked strip's slot leaves the window controls their presses", () => {
  it("is found", () => {
    expect(rule, "no docked rule for the strip's slot").not.toBeNull();
  });

  it("ends at the controls instead of reaching the window edge over them", () => {
    const body = rule![1];
    const right = body.match(/(?:^|[;\s])right:\s*([^;]+);/)?.[1].trim();
    const width = body.match(/(?:^|[;\s])width:\s*([^;]+);/)?.[1].trim();
    const reserve = right?.match(/^calc\(var\(--side-w\) \+ (var\(--[\w-]+\))\)$/)?.[1];
    expect(reserve, `the slot's right edge stops at the controls: ${right}`).toBeTruthy();
    expect(width, "the strip keeps its left edge on the seam").toBe(`calc(var(--dock-col) - ${reserve})`);
    expect(body, "the controls' width is outside the slot, not padding inside it").not.toMatch(/padding-right:\s*max\(/);
  });

  it("reserves the controls' width and nothing where the shell draws none", () => {
    const reserve = rule![1].match(/--([\w-]+):\s*(max\([^;]+\));/);
    expect(reserve, "the reserve has a name and a clamp for shells without controls").not.toBeNull();
    expect(reserve![2]).toMatch(/var\(--winctl-w\)/);
    expect(reserve![2]).toMatch(/var\(--side-w\)/);
  });
});
