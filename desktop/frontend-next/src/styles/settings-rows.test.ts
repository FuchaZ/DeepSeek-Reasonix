import { describe, expect, it } from "vitest";
import settings from "../design/settings.css?raw";
import app from "./app.css?raw";

const rule = (css: string, selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const at = css.search(new RegExp("(?:^|\\n)\\s*" + escaped + " \\{"));
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  return css.slice(open, css.indexOf("}", open));
};

// One anatomy for every settings row: the title and its description take the
// row, and the control sits at its end. Only a continuous input — a slider,
// whose body is the width it needs — keeps the control beside the label.
describe("a settings row's anatomy", () => {
  it("puts a row's label and description first, control last", () => {
    expect(rule(settings, ".srow-meta")).toContain("flex: 1");
    expect(rule(app, ".lrow .tx")).toContain("flex: 1");
  });

  it("sends a segmented control to the row's end instead of leaving half the row blank", () => {
    expect(rule(settings, ".prefs-card .prow > .seg")).toContain("margin-left: auto");
    expect(rule(app, ".rules .fallback > .seg")).toContain("margin-left: auto");
  });
});
