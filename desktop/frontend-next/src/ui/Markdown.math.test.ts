// @vitest-environment jsdom
import { expect, it } from "vitest";
import { normalizeMath } from "./Markdown";

// A line holding only a formula is a display equation, not prose.
it("promotes a standalone $x$ line to a display block", () => {
  expect(normalizeMath("$x$")).toBe("\n\n$$x$$\n\n");
  expect(normalizeMath("  $a^2 + b^2 = c^2$  ")).toBe("\n\n$$a^2 + b^2 = c^2$$\n\n");
});

it("promotes only the formula line inside a larger message", () => {
  const out = normalizeMath("before\n$x$\nafter");
  expect(out).toContain("$$x$$");
  expect(out).toContain("before");
  expect(out).toContain("after");
});

it("leaves inline math inside a sentence unchanged", () => {
  expect(normalizeMath("text $x$ text")).toBe("text $x$ text");
  expect(normalizeMath("the value $x$ and $y$ stay inline")).toBe("the value $x$ and $y$ stay inline");
});

it("leaves a fenced code block unchanged", () => {
  const fenced = "```\n$x$\n```";
  expect(normalizeMath(fenced)).toBe(fenced);
  const span = "use `$x$` here";
  expect(normalizeMath(span)).toBe(span);
});

it("leaves an existing $$x$$ display block unchanged", () => {
  expect(normalizeMath("$$x$$")).toBe("$$x$$");
});

it("still converts LaTeX delimiters", () => {
  expect(normalizeMath("\\[x^2\\]")).toBe("\n\n$$x^2$$\n\n");
  expect(normalizeMath("a \\(x\\) b")).toBe("a $x$ b");
});

it("does not promote a lone money amount", () => {
  expect(normalizeMath("$100")).toBe("$100");
});
