import { describe, expect, it } from "vitest";
import studio from "./studio.css?raw";

const rule = (selector: string): string => {
  const at = studio.lastIndexOf("\n" + selector + " {");
  return at < 0 ? "" : studio.slice(at, studio.indexOf("}", at));
};

describe("the session menu export row", () => {
  it("bounds the popup's grid track, so a wide row cannot push the popup's contents past its 260px", () => {
    expect(rule(".session-pop")).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("cuts the grid item's min-content floor, so the row can shrink inside the fixed 260px popup", () => {
    expect(rule(".session-pop-export")).toMatch(/min-width:\s*0/);
  });

  it("ellipsizes the label instead of clipping the export buttons behind a scrollbar", () => {
    const span = rule(".session-pop-export > span");
    expect(span).toMatch(/min-width:\s*0/);
    expect(span).toMatch(/overflow:\s*hidden/);
    expect(span).toMatch(/text-overflow:\s*ellipsis/);
  });
});
