import { describe, expect, it } from "vitest";
import safe from "../design/safe.css?raw";

const block = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(safe)?.[1] ?? "";
};

describe("safe-area insets on a phone", () => {
  it("keeps the drawer's brand below the status bar without moving a fine-pointer desktop", () => {
    expect(safe).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.rail \.studio-rail-head\s*\{\s*padding-top:\s*calc\(12px \+ var\(--rx-safe-top\)\)/);
  });

  it("stacks the icon rail's padding below the safe inset as well as the chrome", () => {
    expect(block(".nav")).toMatch(/padding-top:\s*calc\(var\(--chrome-h\) \+ var\(--rx-safe-top\) \+ 8px\)/);
  });

  it("lifts the drawer footer's settings row above the gesture bar", () => {
    expect(block(".railfoot")).toMatch(/padding-bottom:\s*calc\(10px \+ var\(--rx-safe-bottom\)\)/);
  });

  it("caps every bottom-anchored popover and lets it scroll instead of clipping its title", () => {
    const caps = /\.studio-overview-anchor \.studio-overview-popover,\s*\.studio-speed-detail,\s*\.studio-context-anchor \.studio-context-summary\s*\{([^}]*)\}/.exec(safe)?.[1] ?? "";
    expect(caps).toMatch(/max-height:\s*calc\(100dvh \/ var\(--zoom, 1\) - var\(--rx-safe-top\) - 32px\)/);
    expect(caps).toMatch(/overflow-y:\s*auto/);
    expect(caps).toMatch(/overflow-x:\s*hidden/);
  });
});
