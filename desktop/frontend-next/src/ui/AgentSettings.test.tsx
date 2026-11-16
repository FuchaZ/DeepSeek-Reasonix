// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import { MockPort } from "../port/mock";
import type { AgentPort } from "../port/port";
import { AgentSettings } from "./AgentSettings";

afterEach(cleanup);

function draw() {
  const go = vi.fn();
  render(
    <>
      <AgentSettings port={new MockPort() as unknown as AgentPort} persona={false} onPersona={go} onChanged={() => {}} />
    </>,
  );
  return go;
}

it("is three cards of single rows, the collaboration blocks and the display switches living elsewhere", async () => {
  draw();
  expect([...document.querySelectorAll(".prefs-card > header h3")].map((h) => h.textContent)).toEqual(["人设与预设", "计划与提问", "自动化"]);
  for (const id of ["persona", "agent-presets", "plan-approval", "ask-timeout", "turn-narration", "progress-watch", "hooks", "scheduled-runs"]) {
    await waitFor(() => expect(document.querySelector(`[data-setting="${id}"]`), id).toBeTruthy());
  }
  // The collaboration blocks moved to the session cross-chat page, and the
  // lease to the safety page that bounds where the agent may reach.
  for (const id of ["session-ref", "subagent-claims", "write-lease", "peers"]) expect(document.querySelector(`[data-setting="${id}"]`), id).toBeNull();
  for (const id of ["plan-mode", "changed-files", "fold-work", "feedback-level-notices"]) expect(document.querySelector(`[data-setting="${id}"]`), id).toBeNull();
});

it("opens the persona editor while keeping presets inline", async () => {
  const go = draw();
  fireEvent.click(screen.getByRole("button", { name: "编辑人设" }));
  expect(go).toHaveBeenCalledExactlyOnceWith();
  await waitFor(() => expect(document.querySelector('[data-action="agent-preset.reload"]')).toBeTruthy());
});

it("exposes hooks and scheduled runs directly in the automation card", async () => {
  draw();
  await waitFor(() => {
    for (const id of ["hooks", "scheduled-runs"]) {
      const region = document.querySelector(`#set-${id}`)!;
      expect(region.querySelector(".grp-items")).toBeTruthy();
      expect(region.querySelector("button")).toBeTruthy();
    }
  });
});
