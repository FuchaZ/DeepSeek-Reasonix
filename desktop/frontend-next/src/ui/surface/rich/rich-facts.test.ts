import { describe, expect, it } from "vitest";
import rich from "./rich.css?raw";

const rule = (selector: string): string => {
  const at = rich.lastIndexOf("\n" + selector + " {");
  return at < 0 ? "" : rich.slice(at, rich.indexOf("}", at));
};

describe("comparison card fact rows", () => {
  it("lets the value wrap inside its own share instead of squeezing the label to one glyph per line", () => {
    const value = rule(".rich-fact-v");
    expect(value).toMatch(/min-width:\s*0/);
    expect(value).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it("keeps the label ellipsized within the card rather than pushing the row past it", () => {
    const label = rule(".rich-fact-lb");
    expect(label).toMatch(/flex:\s*0 1 auto/);
    expect(label).toMatch(/min-width:\s*0/);
    expect(label).toMatch(/overflow:\s*hidden/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
  });
});
