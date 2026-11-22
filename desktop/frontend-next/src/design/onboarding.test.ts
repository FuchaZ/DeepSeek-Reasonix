import { describe, expect, it } from "vitest";
import onboarding from "./onboarding.css?raw";
import studio from "../styles/studio.css?raw";

const rule = (sheet: string, selector: string): string => {
  const at = sheet.lastIndexOf("\n" + selector + " {");
  return at < 0 ? "" : sheet.slice(at, sheet.indexOf("}", at));
};

describe("the onboarding steps header", () => {
  it("cuts the grid item's min-content floor, so nowrap steps cannot push the card past the shell", () => {
    expect(rule(studio, ".onb")).toMatch(/min-width:\s*0/);
  });

  it("lets the steps row shrink with the card instead of feeding it its nowrap width", () => {
    expect(rule(onboarding, ".onb-steps")).toMatch(/min-width:\s*0/);
  });

  it("ellipsizes a squeezed step label span instead of painting it over its neighbours", () => {
    const span = rule(onboarding, ".onb-steps li span");
    expect(span).toMatch(/min-width:\s*0/);
    expect(span).toMatch(/overflow:\s*hidden/);
    expect(span).toMatch(/text-overflow:\s*ellipsis/);
  });
});
