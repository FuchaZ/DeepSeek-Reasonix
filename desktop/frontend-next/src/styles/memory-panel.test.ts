import { describe, expect, it } from "vitest";
import css from "./memory.css?raw";

const rule = (selector: string) => {
  const at = css.lastIndexOf("\n" + selector + " {");
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("the memory panel's height", () => {
  // The detail column is as tall as the list beside it. A body box capped at
  // 220px left most of that column blank, and the editor was shorter still.
  it("lets the body fill the column instead of stopping at a fixed height", () => {
    const pre = rule(".memdetail > pre");
    expect(pre).toContain("flex: 1 1 auto");
    expect(pre).not.toContain("max-height: 220px");
  });

  it("stretches the editor and its body field to the same column", () => {
    expect(rule(".memdetail[data-editing] .memedit")).toContain("flex: 1 1 auto");
    expect(rule(".memedit .body-edit")).toContain("flex: 1 1 auto");
    expect(rule(".memedit .body-edit textarea")).toContain("flex: 1 1 auto");
  });

  it("keeps the list's full row in the new view only while no fact is opened", () => {
    expect(rule('.mem[data-view="new"] .memgrid:not([data-detail])')).toContain("190px minmax(0, 1fr)");
  });
});
