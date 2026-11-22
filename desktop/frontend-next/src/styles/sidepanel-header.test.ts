import { describe, expect, it } from "vitest";
import sidepanel from "./sidepanel.css?raw";

describe("the side-question panel header", () => {
  it("retires the three badges before they can push the collapse and close actions out of the panel", () => {
    expect(sidepanel).toMatch(/@container \(max-width: 430px\)\s*\{\s*\.sidepanel > header \.sidebadge \{ display: none; \} \}/);
  });
});
