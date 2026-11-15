import { describe, expect, it } from "vitest";
import app from "./app.css?raw";
import shell from "../design/shell.css?raw";
import studio from "./studio.css?raw";

// With the workspace column shut, the chrome's left edge carries the drawer
// toggle and the icon rail, both fixed drag surfaces. The folder mark sits
// beside them in the breadcrumb, whose parent is a drag region: a control that
// does not lift itself above those layers loses its press to the OS.
describe("the project mark stays a control in a collapsed title bar", () => {
  it("lifts the crumb above the fixed layers that own the window corner", () => {
    const rule = app.match(/\[data-titlebar="app"\][^{]*\.chrome \.crumb-context\s*\{([^}]*)\}/);
    expect(rule, "no collapsed title-bar rule for the breadcrumb").not.toBeNull();
    expect(rule![1]).toMatch(/position:\s*relative/);
    expect(rule![1]).toMatch(/z-index:\s*(?:4[0-9]|[5-9][0-9]|\d{3,})/);
  });

  it("keeps the folder mark itself out of the drag region", () => {
    const rule = app.match(/\[data-titlebar="app"\][^{]*\.chrome \.crumb-folder\s*\{([^}]*)\}/);
    expect(rule, "no collapsed title-bar rule for the folder mark").not.toBeNull();
    expect(rule![1]).toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("still leaves the rest of the bar draggable", () => {
    expect(app).toMatch(/\[data-titlebar="app"\] \.chrome \{ -webkit-app-region: drag \}/);
    expect(shell).toMatch(/\.chrome \{[^}]*position: relative/);
    expect(studio).toMatch(/\.app\[data-rail="off"\] \{ --rail-toggle-gap: 50px; \}/);
  });
});
