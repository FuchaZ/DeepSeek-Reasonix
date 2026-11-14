import { describe, expect, it } from "vitest";
import { SETTING_AT, pageHome } from "./prefsnav";

// Filing is a judgement about the question a block answers, not about where it
// was first drawn. Each of these sat on a page whose question it did not answer.
describe("where a setting is filed", () => {
  it("files update mode with the version it governs", () => {
    expect(SETTING_AT("update-mode")).toBeTruthy();
    expect(pageHome(SETTING_AT("update-mode")!.section)).toBe("account");
  });

  it("files the write lease with collaboration, not with the sandbox", () => {
    expect(SETTING_AT("write-lease")).toBeTruthy();
    expect(pageHome(SETTING_AT("write-lease")!.section)).toBe("session");
  });

  it("files the renderer switch with performance, not with the palette", () => {
    expect(SETTING_AT("graphics")).toBeTruthy();
    expect(pageHome(SETTING_AT("graphics")!.section)).toBe("controls");
  });
});
