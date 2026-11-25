import { expect, it } from "vitest";

const CSS = import.meta.glob(["./app.css", "./studio.css"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const css = CSS["./app.css"];

it("dims disabled settings navigation and keeps its cursor inactive", () => {
  const rule = css.match(/\.prefs-nav button:disabled,\s*\.prefs-found button:disabled\s*\{([^}]*)\}/)?.[1];
  expect(rule).toBeDefined();
  expect(rule).toMatch(/opacity:\s*\.45\s*;/);
  expect(rule).toMatch(/cursor:\s*default\s*(;|$)/);
});

it("limits navigation row and icon hover styling to enabled buttons", () => {
  expect(css).toMatch(/\.prefs-nav button:not\(:disabled\):hover\s*\{[^}]*background:\s*var\(--overlay\)/);
  expect(css).toMatch(/\.prefs-nav button:not\(:disabled\):hover svg\s*\{[^}]*color:\s*var\(--muted\)/);
});

it.each(Object.entries(CSS))("excludes disabled navigation from every hover override in %s", (_path, stylesheet) => {
  expect(stylesheet.match(/\.prefs-nav button:hover(?:\s|\{)/)).toBeNull();
  expect(stylesheet.match(/\.prefs-nav button:not\(:disabled\):hover\s*\{[^}]*background:/)).not.toBeNull();
});

it("keeps the selected settings section's fill under the pointer in the light theme", () => {
  const studio = CSS["./studio.css"];
  const hover = studio.lastIndexOf(':root[data-theme="light"] .prefs-nav button:not(:disabled):hover');
  const selected = studio.match(/:root\[data-theme="light"\] \.prefs-nav button\[aria-selected="true"\]:not\(:disabled\):hover\s*\{([^}]*)\}/);
  expect(hover).toBeGreaterThan(-1);
  expect(selected).not.toBeNull();
  expect(selected![1]).toMatch(/background:\s*var\(--border\)/);
  expect(studio.indexOf(selected![0])).toBeGreaterThan(hover);
});

it("keeps the selected settings section's icon ink under the pointer", () => {
  const studio = CSS["./studio.css"];
  const rule = studio.match(/\.prefs-nav button\[aria-selected="true"\]:not\(:disabled\):hover svg\s*\{([^}]*)\}/);
  expect(rule).not.toBeNull();
  expect(rule![1]).toMatch(/color:\s*var\(--text\)/);
});

it("dims an off settings branch with ink, not a translucent row", () => {
  // A faded row lands under AA in every theme; perf/contrast.mjs measures the
  // composite, and this holds the rule that keeps the composite readable.
  expect(css.match(/\.subrow\[data-off\]\s*\{[^}]*opacity/)).toBeNull();
  expect(css).toMatch(/\.subrow\[data-off\] \.lb\s*\{[^}]*color:\s*var\(--muted\)/);
});
