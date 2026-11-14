import { describe, expect, it } from "vitest";
import tokens from "./tokens.css?raw";
import turn from "../design/turn.css?raw";
import appCss from "./app.css?raw";

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

// app.css writes its rules at two-space indent, so the selector matches after a
// leading indent rather than at column zero.
const ruleIn = (css: string, selector: string) => {
  const at = css.lastIndexOf(selector + " {");
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

const emphasis = (sheet: string, selector: string) =>
  sheet.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{\\s*--ink-emphasis:\\s*([^;}]+)"))?.[1]?.trim() ?? "";

const lightEmphasis = emphasis(tokens, ':root[data-theme="light"][data-weight="heavy"]');
const darkEmphasis = emphasis(tokens, ':root[data-theme="dark"][data-weight="heavy"]');

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

  // Emphasis cannot gain weight under heavy without passing the Han ceiling, so
  // the difference moves to ink. A pack's own fgStrong still outranks this, and
  // a scheme that never declares the token keeps the body ink.
  it("keeps emphasis legible under heavy by ink rather than by more weight", () => {
    expect(tokens).toContain("--ink-emphasis");
    const strong = ruleIn(appCss, ".md strong");
    expect(strong).toContain("var(--text-strong, var(--ink-emphasis, var(--text)))");
    expect(lightEmphasis).toBeTruthy();
    expect(darkEmphasis).toBeTruthy();
    expect(lightEmphasis).not.toBe(darkEmphasis);
  });
});
