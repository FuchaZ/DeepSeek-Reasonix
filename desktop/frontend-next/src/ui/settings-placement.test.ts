import { describe, expect, it } from "vitest";
import { SETTING_AT, pageHome } from "./prefsnav";

// Filing is a judgement about the question a block answers, not about where it
// was first drawn. Each of these sat on a page whose question it did not answer.
describe("where a setting is filed", () => {
  it("files update mode with the everyday page a person opens first", () => {
    expect(SETTING_AT("update-mode")).toBeTruthy();
    expect(pageHome(SETTING_AT("update-mode")!.section)).toBe("common");
  });

  it("files the write lease with what bounds where the agent may reach", () => {
    expect(SETTING_AT("write-lease")).toBeTruthy();
    expect(pageHome(SETTING_AT("write-lease")!.section)).toBe("tools");
  });

  it("files the renderer switch with the window it draws in", () => {
    expect(SETTING_AT("graphics")).toBeTruthy();
    expect(pageHome(SETTING_AT("graphics")!.section)).toBe("appearance");
  });

  it("files the reference size and the sub-agent's write scope with the collaboration that owns them", () => {
    expect(pageHome(SETTING_AT("session-ref")!.section)).toBe("peers");
    expect(pageHome(SETTING_AT("subagent-claims")!.section)).toBe("peers");
  });
});
