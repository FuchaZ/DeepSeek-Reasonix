// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { MockPort } from "../port/mock";
import type { RuntimeView } from "../port/hub";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function mount(goal: string | undefined, todos: { content: string; status: "pending" | "completed" }[]) {
  const port = new MockPort();
  vi.spyOn(port, "todos").mockImplementation(async () => todos);
  const st = await port.status();
  vi.spyOn(port, "status").mockResolvedValue({ ...st, goal: goal ?? "" });
  return render(<Pane port={port} rt={{ id: "p1", root: "/w", name: "w" } as RuntimeView}
    title="w" active visible sideHost={null} side={false} onFocus={() => {}} onReport={() => {}}
    onSessionChanged={() => {}} pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}} theme="dark" dockW={560} dockMax={880} onDockW={() => {}} />);
}

it("the composer fold carries the goal when there is no plan", async () => {
  const view = await mount("ship the fix", []);
  await waitFor(() => expect(view.container.querySelector(".studio-todo")).not.toBeNull());
  const sum = view.container.querySelector<HTMLButtonElement>('.studio-todo [data-action="plan.fold"]')!;
  expect(sum.textContent).toContain("ship the fix");
  expect(sum.textContent).not.toMatch(/\d+\/\d+/);
  fireEvent.click(sum);
  expect(view.container.querySelector(".studio-todo-body")?.textContent).toContain("ship the fix");
});

it("the goal sits above the steps when both exist", async () => {
  const view = await mount("ship the fix", [{ content: "step one", status: "pending" }]);
  await waitFor(() => expect(view.container.querySelector(".studio-todo")).not.toBeNull());
  fireEvent.click(view.container.querySelector('.studio-todo [data-action="plan.fold"]')!);
  const body = view.container.querySelector(".studio-todo-body")!;
  expect(body.textContent).toContain("ship the fix");
  expect(body.textContent).toContain("step one");
});

it("draws no fold when there is neither a goal nor a plan", async () => {
  const view = await mount(undefined, []);
  await new Promise((r) => setTimeout(r, 50));
  expect(view.container.querySelector(".studio-todo")).toBeNull();
});
