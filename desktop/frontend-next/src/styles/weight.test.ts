import { describe, expect, it } from "vitest";
import tokens from "./tokens.css?raw";
import turn from "../design/turn.css?raw";

const weights = (block: string) => ({
  reg: Number(block.match(/--w-reg:\s*(\d+)/)?.[1]),
  med: Number(block.match(/--w-med:\s*(\d+)/)?.[1]),
  semi: Number(block.match(/--w-semi:\s*(\d+)/)?.[1]),
  think: Number(block.match(/--w-think:\s*(\d+)/)?.[1]),
});

const defaultTier = weights(tokens.match(/:root \{ --w-reg:[^}]*\}/)?.[0] ?? "");
const lightTier = weights(tokens.match(/:root\[data-weight="light"\][^{]*\{[^}]*\}/)?.[0] ?? "");
const heavyTier = weights(tokens.match(/:root\[data-weight="heavy"\] \{[^}]*\}/)?.[0] ?? "");
const tiers: [string, ReturnType<typeof weights>][] = [["default", defaultTier], ["light", lightTier], ["heavy", heavyTier]];

const rule = (selector: string) => {
  const at = turn.lastIndexOf("\n" + selector + " {");
  return at < 0 ? "" : turn.slice(at, turn.indexOf("}", at));
};

describe("the weight tiers", () => {
  it("declares a thought weight beside the body weight at every tier", () => {
    for (const [name, tier] of tiers) {
      expect(tier.reg, `${name} --w-reg`).toBeGreaterThan(0);
      expect(tier.think, `${name} --w-think`).toBeGreaterThan(0);
    }
  });

  // Raising body weight for legibility is a request about prose. It is not a
  // request for reasoning to weigh the same as the answer.
  it("keeps the thought weight below the body weight in every tier", () => {
    expect(lightTier.think).toBeLessThan(lightTier.reg);
    expect(defaultTier.think).toBeLessThan(defaultTier.reg);
    expect(heavyTier.think).toBeLessThan(heavyTier.reg);
  });

  it("keeps emphasis above the body weight without passing the Han ceiling", () => {
    for (const [name, tier] of tiers) {
      expect(tier.semi, `${name} emphasis`).toBeGreaterThan(tier.reg);
      expect(tier.semi, `${name} emphasis stays at or below 700`).toBeLessThanOrEqual(700);
    }
  });

  it("draws thought text from its own token, not from the body weight", () => {
    for (const selector of [".think .tk", ".think .thinking-preview", ".think-note"]) {
      expect(rule(selector), selector).toContain("var(--w-think)");
      expect(rule(selector), selector).not.toContain("var(--w-reg)");
    }
  });
});
