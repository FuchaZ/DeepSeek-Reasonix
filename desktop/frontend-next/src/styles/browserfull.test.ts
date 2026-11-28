import { describe, expect, it } from "vitest";

const CSS = import.meta.glob("./browserfull.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

// The rail is an overlay. A full-width workbench that does not reserve its
// width starts under the rail and clips the session column.
describe("a full-width workbench clears the rail", () => {
  const css = Object.values(CSS)[0];

  it("adds the rail inset to the full workbench's left padding", () => {
    expect(css, "no full-workbench rail inset rule found; this file matches nothing")
      .toMatch(/\.pane\[data-browser-size="full"\][^{]*>\s*\.scroll\[data-pane="browser"\]\s*\{[^}]*padding-left:\s*calc\(var\(--rail-inset/);
  });
});
