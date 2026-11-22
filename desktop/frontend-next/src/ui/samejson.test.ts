import { describe, expect, it } from "vitest";
import { sameJson } from "./samejson";

describe("sameJson", () => {
  it("takes identical primitives as the same", () => {
    expect(sameJson(1, 1)).toBe(true);
    expect(sameJson("a", "a")).toBe(true);
    expect(sameJson(true, true)).toBe(true);
    expect(sameJson(null, null)).toBe(true);
    expect(sameJson(undefined, undefined)).toBe(true);
  });

  it("takes different primitives as different", () => {
    expect(sameJson(1, 2)).toBe(false);
    expect(sameJson("a", "b")).toBe(false);
    expect(sameJson(1, "1")).toBe(false);
    expect(sameJson(null, undefined)).toBe(false);
    expect(sameJson(0, false)).toBe(false);
    expect(sameJson(null, {})).toBe(false);
  });

  it("takes deep-equal objects of different identity as the same", () => {
    expect(sameJson({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameJson({}, {})).toBe(true);
    expect(sameJson([], [])).toBe(true);
    expect(sameJson({ a: { b: [1, { c: "x" }, true] } }, { a: { b: [1, { c: "x" }, true] } })).toBe(true);
    expect(sameJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it("takes a nested difference as different", () => {
    expect(sameJson({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
    expect(sameJson({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("treats array order as part of the value", () => {
    expect(sameJson([1, 2], [2, 1])).toBe(false);
    expect(sameJson([1, 2], [1, 2])).toBe(true);
    expect(sameJson([1], [1, 1])).toBe(false);
  });

  it("separates null from a missing key", () => {
    expect(sameJson({ a: null }, {})).toBe(false);
    expect(sameJson({}, { a: null })).toBe(false);
    expect(sameJson({ a: null }, { a: null })).toBe(true);
    expect(sameJson({ a: null }, { b: null })).toBe(false);
  });

  it("answers two objects of different key counts by the fast path", () => {
    expect(sameJson({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("does not cross an array with an object", () => {
    expect(sameJson([1], { 0: 1 })).toBe(false);
    expect(sameJson([], {})).toBe(false);
  });
});
