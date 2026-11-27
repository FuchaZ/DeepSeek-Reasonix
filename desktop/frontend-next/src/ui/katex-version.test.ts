import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const pkg = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

it("pins katex to the version rehype-katex renders, so the imported CSS matches", () => {
  expect(pkg.dependencies.katex).toBe("0.16.47");
});
