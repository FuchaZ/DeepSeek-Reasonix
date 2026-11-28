// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { MockPort } from "../port/mock";
import type { AgentPort } from "../port/port";
import type { RuntimeView } from "../port/hub";
import type { WireEvent } from "../port/wire";

Element.prototype.getAnimations ??= () => [];

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

async function mount() {
  const port = new MockPort();
  let emit: (ev: WireEvent) => void = () => {};
  const subscribe = port.subscribe.bind(port);
  vi.spyOn(port, "subscribe").mockImplementation((onEvent, onGap, bootstrap) => {
    emit = onEvent;
    return subscribe(onEvent, onGap, bootstrap);
  });
  // App wires the dock the same way: the pane asks, the window holds the flag.
  function Window() {
    const [manual, setManual] = useState(false);
    return <Pane port={port as AgentPort} rt={{ id: "p1", root: "/w", name: "w" } as RuntimeView}
      title="w" active visible sideHost={null} side={false} onFocus={() => {}} onReport={() => {}} onSessionChanged={() => {}}
      pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}} theme="dark" dockW={560} dockMax={880} onDockW={() => {}}
      manualBrowser={manual} onManualBrowser={setManual} />;
  }
  render(<Window />);
  await act(async () => {});
  const send = (ev: Record<string, unknown>) => act(() => emit(ev as unknown as WireEvent));
  return { port, send };
}

describe("a shell block in a reply", () => {
  it("runs in a terminal and brings that terminal into view", async () => {
    const { port, send } = await mount();
    const input = vi.spyOn(port, "terminalInput");
    await send({ kind: "turn_started" });
    await send({ kind: "text", text: "```bash\npython tray.py --quit\n```" });
    await send({ kind: "message", text: "```bash\npython tray.py --quit\n```" });

    await waitFor(() => expect(document.querySelector('[data-action="code.run"]')).not.toBeNull());
    fireEvent.click(document.querySelector<HTMLElement>('[data-action="code.run"]')!);

    await waitFor(() => expect(input).toHaveBeenCalledWith("t1", "python tray.py --quit\r"));
    await waitFor(() => expect(document.querySelector('[data-key="terminal:t1"]')?.getAttribute("aria-selected")).toBe("true"));
  });
});
