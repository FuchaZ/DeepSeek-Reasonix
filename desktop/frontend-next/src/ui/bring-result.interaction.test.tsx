// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { ToolCard } from "./cards/ToolCard";
import { MockPort } from "../port/mock";
import type { RuntimeView } from "../port/hub";
import type { WireEvent } from "../port/wire";

Element.prototype.getAnimations ??= () => [];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("the bring-to-end action on a tool card", () => {
  const done = { id: "c1", name: "bash", args: "{}", output: "hello result", readOnly: true } as never;

  it("is offered on a finished call that has something to show, and reports the press", () => {
    const onBring = vi.fn();
    render(<ToolCard tool={done} running={false} onBring={onBring} />);
    const button = document.querySelector<HTMLButtonElement>('[data-action="tool.bring"]')!;
    expect(button).not.toBeNull();
    expect(button.getAttribute("aria-label")).toBe("把结果带到末尾");
    fireEvent.click(button);
    expect(onBring).toHaveBeenCalledOnce();
  });

  it("is not offered while the call runs, without a call id, or without an output to bring", () => {
    const onBring = vi.fn();
    const { rerender } = render(<ToolCard tool={done} running onBring={onBring} />);
    expect(document.querySelector('[data-action="tool.bring"]')).toBeNull();
    rerender(<ToolCard tool={{ ...(done as object), id: undefined } as never} running={false} onBring={onBring} />);
    expect(document.querySelector('[data-action="tool.bring"]')).toBeNull();
    rerender(<ToolCard tool={{ ...(done as object), output: "" } as never} running={false} onBring={onBring} />);
    expect(document.querySelector('[data-action="tool.bring"]')).toBeNull();
    rerender(<ToolCard tool={done} running={false} />);
    expect(document.querySelector('[data-action="tool.bring"]')).toBeNull();
  });
});

async function mount() {
  const port = new MockPort();
  let emit: (ev: WireEvent) => void = () => {};
  const subscribe = port.subscribe.bind(port);
  vi.spyOn(port, "subscribe").mockImplementation((onEvent, onGap, bootstrap) => {
    emit = onEvent;
    return subscribe(onEvent, onGap, bootstrap);
  });
  const view = render(<Pane port={port} rt={{ id: "p1", root: "/w", name: "w" } as RuntimeView}
    title="w" active visible sideHost={null} side={false} onFocus={() => {}} onReport={() => {}}
    onSessionChanged={() => {}} pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}} theme="dark" dockW={560} dockMax={880} onDockW={() => {}} />);
  const send = (ev: Record<string, unknown>) => act(() => emit(ev as unknown as WireEvent));
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  return { port, view, send };
}

function turnWithTools(send: (ev: Record<string, unknown>) => void) {
  send({ kind: "turn_started" });
  send({ kind: "tool_dispatch", tool: { id: "t1", name: "bash", args: "{}" } });
  send({ kind: "tool_result", tool: { id: "t1", name: "bash", args: "{}", output: "first output", durationMs: 40 } });
  send({ kind: "tool_dispatch", tool: { id: "t2", name: "bash", args: "{}" } });
  send({ kind: "tool_result", tool: { id: "t2", name: "bash", args: "{}", output: "second output", durationMs: 40 } });
  send({ kind: "message", text: "all done, summary here" });
  send({ kind: "turn_done" });
}

const brought = (root: ParentNode) => [...root.querySelectorAll(".brought .call[data-call]")].map((el) => el.getAttribute("data-call"));
const bringOf = (root: ParentNode, id: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('[data-action="tool.bring"]')].find((b) => !b.closest(".brought") && b.closest(".call")?.getAttribute("data-call") === id)!;

describe("a call brought to the end of the transcript", () => {
  it("appears after everything else with its own output, and the original stays where it was", async () => {
    const { view, send } = await mount();
    turnWithTools(send);
    await waitFor(() => expect(view.container.querySelector('[data-action="tool.bring"]')).not.toBeNull());
    expect(brought(view.container)).toEqual([]);
    fireEvent.click(bringOf(view.container, "t1"));
    await waitFor(() => expect(brought(view.container)).toHaveLength(1));
    const section = view.container.querySelector(".brought")!;
    expect(section.textContent).toContain("first output");
    const flow = view.container.querySelector(".flow")!;
    const kids = [...flow.children];
    expect(kids.indexOf(section)).toBeGreaterThan(kids.findIndex((el) => el.textContent?.includes("all done, summary here")));
    expect(view.container.querySelectorAll('[data-call="t1"]').length).toBe(2);
  });

  it("brings the same call once, moves it last when brought again, and lets it be dismissed", async () => {
    const { view, send } = await mount();
    turnWithTools(send);
    await waitFor(() => expect(view.container.querySelectorAll('[data-action="tool.bring"]').length).toBeGreaterThan(1));
    const press = (id: string) => fireEvent.click(bringOf(view.container, id));
    press("t1");
    press("t2");
    await waitFor(() => expect(brought(view.container)).toEqual(["t1", "t2"]));
    press("t1");
    await waitFor(() => expect(brought(view.container)).toEqual(["t2", "t1"]));
    fireEvent.click(view.container.querySelector<HTMLButtonElement>('.brought [data-action="tool.unbring"]')!);
    await waitFor(() => expect(brought(view.container)).toHaveLength(1));
  });

  it("is a view only: nothing is sent to the kernel and the transcript items are untouched", async () => {
    const { view, send, port } = await mount();
    turnWithTools(send);
    await waitFor(() => expect(view.container.querySelector('[data-action="tool.bring"]')).not.toBeNull());
    const sendSpy = vi.spyOn(port, "submit");
    const before = view.container.querySelectorAll(".flow .enterbox").length;
    fireEvent.click(bringOf(view.container, "t1"));
    await waitFor(() => expect(brought(view.container)).toHaveLength(1));
    expect(sendSpy).not.toHaveBeenCalled();
    expect(view.container.querySelectorAll(".flow .enterbox").length).toBe(before);
  });

  it("offers no bring button on the brought copy itself", async () => {
    const { view, send } = await mount();
    turnWithTools(send);
    await waitFor(() => expect(view.container.querySelector('[data-action="tool.bring"]')).not.toBeNull());
    fireEvent.click(bringOf(view.container, "t1"));
    await waitFor(() => expect(brought(view.container)).toHaveLength(1));
    expect(view.container.querySelector('.brought [data-action="tool.bring"]')).toBeNull();
  });
});
