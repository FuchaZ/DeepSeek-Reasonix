import { describe, expect, it } from "vitest";

const SHEET = Object.values(
  import.meta.glob("./studio.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];
const NARROW = Object.values(
  import.meta.glob("./narrow.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0];

interface Rule {
  selector: string;
  decls: Map<string, string>;
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const part of m[2].split(";")) {
      const at = part.indexOf(":");
      if (at > 0) decls.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
    }
    out.push({ selector: m[1].trim(), decls });
  }
  return out;
}

describe("status rail figures hold their width", () => {
  const rail = rules(SHEET).filter((r) => r.selector.split(",").some((s) => s.includes(".studio-meterrail")));

  it("finds the rail rules", () => {
    expect(rail.length).toBeGreaterThan(0);
  });

  it("keeps tabular numerals on every rule that sets the font shorthand", () => {
    const reset = rail
      .filter((r) => r.decls.has("font") && r.decls.get("font-variant-numeric") !== "tabular-nums")
      .map((r) => r.selector.replace(/\s+/g, " "));
    expect(reset, "the font shorthand resets font-variant-numeric; restate tabular-nums in the same rule").toEqual([]);
  });

  it("reserves the width of a three-digit speed so 9.9 to 10.0 and 99.9 to 100.0 do not move its neighbours", () => {
    const speed = rail.find((r) => r.selector === ".studio-meterrail .studio-meter-speed b");
    expect(speed?.decls.get("min-width")).toBe("5ch");
  });

  // The two sit side by side, so a leading that differs by a fraction of a pixel
  // moves the turn count off the line the tariff is drawn on.
  it("puts the turn count on the leading the tariff beside it is drawn with", () => {
    const tariff = rail.find((r) => r.selector === ".studio-meterrail .studio-meter-tariff");
    const leading = /var\(--fs-micro\)\s*\/\s*([\d.]+)/.exec(tariff?.decls.get("font") ?? "")?.[1];
    expect(leading, "the tariff's line-height in its font shorthand").toBe("1.2");
    const chip = rail.find((r) => r.selector.split(",").some((s) => s.trim() === ".studio-meterrail .studio-meter-turns"));
    expect(chip?.decls.get("line-height")).toBe(leading);
  });

  // A label drawn heavier than the ones beside it reads as sunk even on the same
  // baseline, so it takes the ink the context and cache labels already use.
  it("draws the turn count's label in the ink its neighbours use", () => {
    const inkOf = (selector: string) =>
      rules(SHEET)
        .filter((r) => r.decls.has("color") && r.selector.split(",").some((s) => s.trim() === selector))
        .at(-1)?.decls.get("color");
    const neighbour = inkOf(".studio-meter-cache > span");
    expect(neighbour, "the ink the cache label is drawn in").toBeTruthy();
    expect(inkOf(".studio-meter-turns > span")).toBe(neighbour);
  });

  // The rail's figure rule restates the font shorthand, which resets the leading
  // to 1. Inside a chip whose label takes its neighbour's taller one, that shorter
  // line box is rounded onto a lower row and the figure sinks under its label.
  it("keeps the turn count's figure on its label's leading", () => {
    const figure = rail.find((r) => r.selector.split(",").some((s) => s.trim() === ".studio-meterrail .studio-meter-turns > b"));
    expect(figure?.decls.get("line-height"), "the figure's leading, which the rail's font shorthand otherwise resets to 1").toBe("1.2");
  });
});

// The rail is one row. When it cannot hold every readout, a chip gives up its
// label and keeps the two things that still answer: its mark and its count. A
// rigid chip does neither and passes the rail's edge instead.
describe("a deck chip yields before it leaves the rail", () => {
  const all = rules(NARROW);
  const one = (selector: string) =>
    all.filter((r) => r.selector.split(",").some((s) => s.trim() === selector)).at(-1);

  it("lets the anchor and the chip take less than their content's width", () => {
    for (const selector of [".studio-deck-anchor", ".studio-deckchip"]) {
      expect(one(selector)?.decls.get("flex"), selector).toBe("0 1 auto");
      expect(one(selector)?.decls.get("min-width"), selector).toBe("0");
    }
  });

  it("clips the label while the mark and the count keep their size", () => {
    const label = one(".studio-deckchip > span");
    expect(label?.decls.get("text-overflow")).toBe("ellipsis");
    expect(one(".studio-deckchip .studio-icon")?.decls.get("flex")).toBe("none");
    expect(one(".studio-deckchip b")?.decls.get("flex")).toBe("none");
  });
});
