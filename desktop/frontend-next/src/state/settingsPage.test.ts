// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { lastSettingsPage, rememberSettingsPage } from "./settingsPage";

beforeEach(() => localStorage.clear());

describe("which settings page the sheet comes back to", () => {
  it("answers nothing until this window has opened the sheet", () => {
    // "" is what makes the first visit land on 常用 rather than on a page the
    // reader never chose.
    expect(lastSettingsPage()).toBe("");
  });

  it("reads back the section it was last left on", () => {
    rememberSettingsPage("appearance");
    expect(lastSettingsPage()).toBe("appearance");
    rememberSettingsPage("tools");
    expect(lastSettingsPage()).toBe("tools");
  });

  it("ignores a stored value that names no section", () => {
    // A build that once knew a section this one does not must not strand the
    // sheet on a blank page: an unknown name reads as "nothing remembered".
    localStorage.setItem("rx-settings-page", "not-a-section");
    expect(lastSettingsPage()).toBe("");
  });
});
