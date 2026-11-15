// @vitest-environment jsdom
import "./testkit";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { CompositionEditor } from "./CompositionEditor";
import { MockPort } from "../port/mock";
import type { AgentComposition, AgentPresetCatalog } from "../port/composition";

afterEach(cleanup);

// The switch is the only control that decides this field, so what it writes is
// the whole contract: absent means saved memory is injected, and a preset that
// never touched the switch must keep the revision it was saved with.
async function open(persona: AgentComposition["persona"]) {
  const port = new MockPort();
  const catalog: AgentPresetCatalog = await port.agentPresets();
  const draft = structuredClone(catalog.presets[0].definition);
  draft.id = "user:memory-switch";
  draft.persona = persona;
  let current: AgentComposition = draft;
  const props = () => ({
    draft: current,
    modules: catalog.modules,
    disabled: false,
    creating: true,
    onChange: (next: AgentComposition) => {
      current = next;
      view.rerender(<CompositionEditor {...props()} />);
    },
    onValidityChange: () => {},
  });
  const view = render(<CompositionEditor {...props()} />);
  return {
    switch: () => screen.getByRole("switch", { name: "不注入记忆" }),
    get saved() { return current; },
  };
}

it("withholds memory by writing false, and restores it by removing the field", async () => {
  const editor = await open({ prefix: "", suffix: "", include_runtime_context: true });
  expect(editor.switch().getAttribute("aria-checked")).toBe("false");

  await userEvent.click(editor.switch());
  expect(editor.saved.persona).toEqual({ prefix: "", suffix: "", include_runtime_context: true, include_memory: false });
  expect(editor.switch().getAttribute("aria-checked")).toBe("true");

  await userEvent.click(editor.switch());
  expect(editor.saved.persona).toEqual({ prefix: "", suffix: "", include_runtime_context: true });
  expect("include_memory" in editor.saved.persona).toBe(false);
  expect(editor.switch().getAttribute("aria-checked")).toBe("false");
});

it("reads a preset that already withholds memory as on, and leaves its other persona text alone", async () => {
  const editor = await open({ prefix: "Rigorous.", suffix: "Be terse.", include_runtime_context: false, include_memory: false });
  expect(editor.switch().getAttribute("aria-checked")).toBe("true");

  await userEvent.click(editor.switch());
  expect(editor.saved.persona).toEqual({ prefix: "Rigorous.", suffix: "Be terse.", include_runtime_context: false });
});
