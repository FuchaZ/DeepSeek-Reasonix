// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import "./testkit";
import { SettingsNav } from "./SettingsNav";
import type { Section } from "./prefsnav";

afterEach(() => { cleanup(); delete document.documentElement.dataset.fold; });
beforeEach(() => { document.documentElement.dataset.fold = "rail side scene"; });

const values = new Proxy({}, { get: () => "" }) as Record<Section, string>;
const draw = (at: Section) =>
  render(<SettingsNav at={at} values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);

const navOf = () => document.querySelector<HTMLElement>(".prefs-nav")!;

function measure(el: HTMLElement, m: { left?: number; top?: number; width?: number; height?: number }) {
  const left = m.left ?? 0;
  const top = m.top ?? 0;
  const width = m.width ?? 0;
  const height = m.height ?? 0;
  el.getBoundingClientRect = () => ({
    left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
  }) as DOMRect;
}

function sizing(el: HTMLElement, dims: Record<string, number>) {
  for (const [name, value] of Object.entries(dims)) Object.defineProperty(el, name, { configurable: true, writable: true, value });
}

it("slides the strip by its own scrollLeft to reveal a selected tab, without touching scrollIntoView", () => {
  const { rerender } = draw("common");
  const nav = navOf();
  sizing(nav, { clientWidth: 421, scrollWidth: 1153, clientHeight: 64, scrollHeight: 64, scrollLeft: 626, scrollTop: 0, clientLeft: 0, clientTop: 0 });
  measure(nav, { width: 421, height: 64 });
  const target = document.querySelector<HTMLElement>("#prefs-network")!;
  measure(target, { left: 1053 - 626, width: 100, height: 32 });

  const original = Element.prototype.scrollIntoView;
  const into = vi.fn();
  Element.prototype.scrollIntoView = into;
  try {
    rerender(<SettingsNav at="network" values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);
    expect(nav.scrollLeft).toBe(732);
    expect(into).not.toHaveBeenCalled();
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

it("reads a scaled rect in layout pixels", () => {
  const { rerender } = draw("common");
  const nav = navOf();
  sizing(nav, { clientWidth: 400, scrollWidth: 1153, clientHeight: 64, scrollHeight: 64, scrollLeft: 0, scrollTop: 0, clientLeft: 0, clientTop: 0 });
  measure(nav, { width: 380, height: 61 });
  const target = document.querySelector<HTMLElement>("#prefs-network")!;
  measure(target, { left: 475, width: 95, height: 30 });

  rerender(<SettingsNav at="network" values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);
  expect(nav.scrollLeft).toBe(208);
});

it("leaves the strip alone when the selected tab is already whole", () => {
  const { rerender } = draw("common");
  const nav = navOf();
  sizing(nav, { clientWidth: 421, scrollWidth: 1153, clientHeight: 64, scrollHeight: 64, scrollLeft: 626, scrollTop: 0, clientLeft: 0, clientTop: 0 });
  measure(nav, { width: 421, height: 64 });
  const target = document.querySelector<HTMLElement>("#prefs-network")!;
  measure(target, { left: 700 - 626, width: 100, height: 32 });

  rerender(<SettingsNav at="network" values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);
  expect(nav.scrollLeft).toBe(626);
});

it("keeps the place the reader scrolled to while the selection has not moved", () => {
  const { rerender } = draw("common");
  const nav = navOf();
  sizing(nav, { clientWidth: 421, scrollWidth: 1153, clientHeight: 64, scrollHeight: 64, scrollLeft: 626, scrollTop: 0, clientLeft: 0, clientTop: 0 });
  measure(nav, { width: 421, height: 64 });
  nav.scrollLeft = 100;

  rerender(<SettingsNav at="common" values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);
  expect(nav.scrollLeft).toBe(100);
});

it("moves only the vertical column when the strip is a tall sidebar", () => {
  const { rerender } = draw("common");
  const nav = navOf();
  sizing(nav, { clientWidth: 240, scrollWidth: 240, clientHeight: 300, scrollHeight: 900, scrollLeft: 0, scrollTop: 0, clientLeft: 0, clientTop: 0 });
  measure(nav, { width: 240, height: 300 });
  const target = document.querySelector<HTMLElement>("#prefs-network")!;
  measure(target, { top: 600, left: 0, width: 220, height: 34 });

  rerender(<SettingsNav at="network" values={values} shown={() => true} danger={() => false} disabled={false} onSelect={() => {}} />);
  expect(nav.scrollTop).toBe(342);
  expect(nav.scrollLeft).toBe(0);
});
