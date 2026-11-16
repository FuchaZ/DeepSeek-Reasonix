// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { MockPort } from "../port/mock";
import type { RuntimeView } from "../port/hub";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(port = new MockPort()) {
  return render(<Pane port={port} rt={{ id: "p1", root: "/w", name: "w" } as RuntimeView}
    title="w" active visible sideHost={null} side={false} onFocus={() => {}} onReport={() => {}}
    onSessionChanged={() => {}} pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}} theme="dark" dockW={560} dockMax={880} onDockW={() => {}} />);
}

const entry = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-action="side.toggle"]');

it("the side question is an icon in the composer toolbar, right after the attach button", async () => {
  const view = mount();
  await waitFor(() => expect(entry(view.container)).not.toBeNull());
  const button = entry(view.container)!;
  expect(button.closest(".turntools")).not.toBeNull();
  expect(button.previousElementSibling?.getAttribute("aria-label")).toBe("添加附件");
  expect(button.getAttribute("aria-label")).toBe("辅助会话");
  expect(button.textContent).not.toContain("辅助会话 ");
  expect(view.container.querySelector(".sidetoggle")).toBeNull();
});

it("opens and closes the side panel, and says which state it is in", async () => {
  const view = mount();
  await waitFor(() => expect(entry(view.container)).not.toBeNull());
  const button = entry(view.container)!;
  expect(button.getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(button);
  expect(await screen.findByRole("textbox", { name: "向辅助会话提问" })).not.toBeNull();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  await waitFor(() => expect(screen.queryByRole("textbox", { name: "向辅助会话提问" })).toBeNull());
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

it("stays available while a turn is running", async () => {
  const port = new MockPort();
  const st = await port.status();
  vi.spyOn(port, "status").mockResolvedValue({ ...st, running: true });
  const view = mount(port);
  await waitFor(() => expect(entry(view.container)).not.toBeNull());
  await new Promise((r) => setTimeout(r, 50));
  expect(entry(view.container)!.disabled).toBe(false);
});
