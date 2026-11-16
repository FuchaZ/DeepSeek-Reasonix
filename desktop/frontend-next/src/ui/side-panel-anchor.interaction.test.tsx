// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "./testkit";
import { Pane } from "./Pane";
import { MockPort } from "../port/mock";
import type { RuntimeView } from "../port/hub";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mount(id = "p1") {
  return render(<Pane port={new MockPort()} rt={{ id, root: "/w", name: "w" } as RuntimeView}
    title="w" active visible sideHost={null} side={false} onFocus={() => {}} onReport={() => {}}
    onSessionChanged={() => {}} pulse={0} findPulse={0} onSettings={() => {}} onOpenProject={() => {}} theme="dark" dockW={560} dockMax={880} onDockW={() => {}} />);
}

const toggle = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-action="side.toggle"]')!;
const ready = async (view: ReturnType<typeof mount>) => { await waitFor(() => expect(toggle(view.container)).not.toBeNull()); return toggle(view.container); };

it("opens inside the composer it was asked from, not loose on the pane", async () => {
  const view = mount();
  const button = await ready(view);
  fireEvent.click(button);
  const panel = await screen.findByRole("complementary", { name: "辅助会话" });
  expect(panel.closest(".compose")).toBe(button.closest(".compose"));
});

it("closes on Escape and hands focus back to the button that opened it", async () => {
  const view = mount();
  const button = await ready(view);
  fireEvent.click(button);
  const box = await screen.findByRole("textbox", { name: "向辅助会话提问" });
  box.focus();
  fireEvent.keyDown(box, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "辅助会话" })).toBeNull());
  expect(document.activeElement).toBe(button);
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

it("returns focus to the button when the close cross is used, too", async () => {
  const view = mount();
  const button = await ready(view);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "关闭辅助会话" }));
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "辅助会话" })).toBeNull());
  expect(document.activeElement).toBe(button);
});

it("keeps one panel per pane and a fresh one on reopening", async () => {
  const a = mount("a");
  const b = mount("b");
  const first = await ready(a);
  await ready(b);
  fireEvent.click(first);
  await screen.findByRole("complementary", { name: "辅助会话" });
  expect(b.container.querySelector(".sidepanel")).toBeNull();
  fireEvent.click(first);
  await waitFor(() => expect(a.container.querySelector(".sidepanel")).toBeNull());
  fireEvent.click(first);
  expect((await screen.findByRole("textbox", { name: "向辅助会话提问" }) as HTMLTextAreaElement).value).toBe("");
});


it("closes the collapsed panel with Escape, restores focus and reopens expanded", async () => {
  const view = mount();
  const button = await ready(view);
  fireEvent.click(button);
  fireEvent.click(await screen.findByRole("button", { name: "收起辅助会话" }));
  const expand = screen.getByRole("button", { name: "展开辅助会话" });
  expand.focus();
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.keyDown(expand, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("complementary", { name: "辅助会话" })).toBeNull());
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  expect(await screen.findByRole("textbox", { name: "向辅助会话提问" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "收起辅助会话" }).getAttribute("aria-expanded")).toBe("true");
});
