// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// These tests describe the feedback channel while it exists; the shipped build has it retired.
vi.mock("../feedbackchannel", () => ({ FEEDBACK_RETIRED: false }));
import "./testkit";
import { MockPort } from "../port/mock";
import type { AgentPort } from "../port/port";
import { Appearance } from "./Appearance";
import { ChatDisplaySettings } from "./ChatDisplaySettings";
import { OpsSettings } from "./OpsSettings";

afterEach(cleanup);

const frame = (node: React.ReactNode) =>
  render(<>{node}</>);
const titles = () => [...document.querySelectorAll(".prefs-card > header h3")].map((h) => h.textContent);
const has = (id: string) => !!document.querySelector(`[data-setting="${id}"]`);

it("expands appearance editors in theme, text and window cards", async () => {
  const port = new MockPort() as unknown as AgentPort;
  frame(<Appearance port={port} theme="auto" onTheme={() => {}} contrast="" onContrast={() => {}} weight="" onWeight={() => {}}
    reloadThemes={() => {}} look={{}} onLook={() => {}} />);
  expect(titles().slice(0, 3)).toEqual(["主题", "文字", "窗口"]);
  for (const id of ["mode", "scheme", "wallpaper", "effects", "font", "size", "weight", "contrast", "window"]) await waitFor(() => expect(has(id), id).toBe(true));
  expect(has("advanced-appearance")).toBe(false);
  expect(screen.getByRole("combobox", { name: "界面" })).toBeTruthy();
  expect(screen.getByRole("slider", { name: "界面大小微调" })).toBeTruthy();
});

it("conversation display is process, tabs and navigation, files and previews, and notices", async () => {
  const port = new MockPort() as unknown as AgentPort;
  frame(<ChatDisplaySettings port={port} />);
  expect(titles()).toEqual(["过程", "标签与导航", "文件与预览", "提示"]);
  for (const id of ["fold-work", "folding", "plan-progress", "session-tabs", "session-quick-actions", "navrail", "naventries", "live-grace", "changed-files", "present-files", "office-preview", "new-answer-marker", "feedback-level-notices"]) {
    await waitFor(() => expect(has(id), id).toBe(true));
  }
});

it("operation and performance runs the switches, the performance card, and a keys card folded shut at the end", async () => {
  frame(<OpsSettings />);
  expect(titles()).toEqual(["运行中", "性能", "快捷键"]);
  for (const id of ["running-message-intent", "composer-hint", "page-sleep"]) {
    expect(has(id), id).toBe(true);
  }
  // The keys card answers a reference question, so it folds shut: its rows
  // appear when the head is pressed, and a landing on one of them opens it.
  // The global shortcut answers the shell's own window, so a browser tab
  // draws none of it.
  for (const id of ["keys", "esc-stop"]) expect(has(id), id).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "快捷键" }));
  for (const id of ["keys", "esc-stop"]) {
    await waitFor(() => expect(has(id), id).toBe(true));
  }
  expect(screen.getByRole("button", { name: "快捷键" }).getAttribute("aria-expanded")).toBe("true");
});
