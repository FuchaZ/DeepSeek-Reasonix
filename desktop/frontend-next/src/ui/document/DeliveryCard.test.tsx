// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DeliveryCard } from "./DeliveryCard";
import type { ReplyActions } from "../cards/SayCard";
import "../testkit";

afterEach(cleanup);

it.each(["line\nbreak.md", "trailing\\", "github:report.md", "notes)"])("does not add an ambiguous file reference for %j", async (path) => {
  const user = userEvent.setup(), reply = actions(), add = vi.fn();
  reply.onAddFile = add;
  render(<DeliveryCard files={[{ path }]} reply={reply} />);
  await user.click(screen.getByRole("button", { name: /^更多操作/ }));
  const item = screen.getByRole("menuitem", { name: "添加到对话" }) as HTMLButtonElement;
  expect(item.disabled).toBe(true);
  const copy = screen.getByRole("menuitem", { name: "复制路径" });
  await waitFor(() => expect(document.activeElement).toBe(copy));
  await user.click(item);
  expect(add).not.toHaveBeenCalled();
});

it("opens the structured file identity without interpreting percent escapes or Windows separators", () => {
  const open = vi.fn();
  const file = { root: "D:\\Library", path: "方案 100%.md", description: "Report" };
  const select = vi.fn(() => open);
  const reply: ReplyActions = {
    files: { file: select, link: () => null, image: () => null },
    onQuote: vi.fn(), canRegenerate: () => false, hasLaterTurns: () => false,
    onRegenerate: vi.fn(), canBranch: () => false, onBranch: vi.fn(),
  };
  const { getByRole } = render(<DeliveryCard files={[file]} reply={reply} />);
  fireEvent.click(getByRole("button", { name: /^预览.*方案 100%.md/ }));
  expect(select).toHaveBeenCalledWith(file);
  expect(open).toHaveBeenCalledOnce();
});

const actions = (): ReplyActions => ({
  files: { file: () => vi.fn(), link: () => null, image: () => null },
  onQuote: vi.fn(), canRegenerate: () => false, hasLaterTurns: () => false,
  onRegenerate: vi.fn(), canBranch: () => false, onBranch: vi.fn(),
});

it("keeps auxiliary actions in a menu and adds a file without opening its preview", async () => {
  const user = userEvent.setup();
  const open = vi.fn(), add = vi.fn(), reply = actions();
  reply.files!.file = () => open;
  reply.onAddFile = add;
  render(<DeliveryCard files={[{ path: "report.pdf", description: "Quarterly report" }]} reply={reply} />);
  expect(screen.queryByRole("button", { name: "添加到对话" })).toBeNull();
  await user.click(screen.getByRole("button", { name: /更多.*report.pdf/ }));
  await user.click(screen.getByRole("menuitem", { name: "添加到对话" }));
  expect(add).toHaveBeenCalledWith("@report.pdf");
  expect(open).not.toHaveBeenCalled();
  expect(screen.queryByRole("menu")).toBeNull();
  await screen.findByText("已添加到输入框");
});

it("uses full file identity for the current-view indicator and distinguishes equal basenames", () => {
  const reply = { ...actions(), activeFile: "docs/report.md" };
  const files = [{ path: "docs/report.md" }, { path: "other/report.md" }];
  const { rerender } = render(<DeliveryCard files={files} reply={reply} />);
  const buttons = screen.getAllByRole("button", { name: /^预览/ });
  expect(buttons[0].getAttribute("aria-current")).toBe("true");
  expect(buttons[1].hasAttribute("aria-current")).toBe(false);
  expect(screen.getAllByText("查看中")).toHaveLength(1);
  expect(screen.getByText("docs")).toBeTruthy();
  expect(screen.getByText("other")).toBeTruthy();
  rerender(<DeliveryCard files={files} reply={{ ...reply, activeFile: undefined }} />);
  expect(screen.queryByText("查看中")).toBeNull();
});

it("supports keyboard menus and restores focus when Escape closes them", async () => {
  const user = userEvent.setup();
  render(<DeliveryCard files={[{ path: "notes.md" }]} reply={actions()} />);
  const more = screen.getByRole("button", { name: /更多.*notes.md/ });
  await user.click(more);
  const item = screen.getByRole("menuitem", { name: "复制路径" });
  await waitFor(() => expect(document.activeElement).toBe(item));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(more);
});

const picture = (src = "/rt/r1/workspace/image?path=heart-gaps.png"): ReplyActions => ({
  ...actions(),
  files: { file: () => vi.fn(), link: () => null, image: () => null, imageOf: () => src },
});

it.each(["heart-gaps.png", "heart-gaps.jpg", "shots/HEART-GAPS.JPEG", "a.webp"])("shows a presented %s as a picture above its row", (path) => {
  render(<DeliveryCard files={[{ path }]} reply={picture()} />);
  const img = screen.getAllByRole("img")[0];
  expect(img.getAttribute("src")).toBe("/rt/r1/workspace/image?path=heart-gaps.png");
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(screen.getByRole("button", { name: `预览 ${path.split("/").at(-1)}` })).toBeTruthy();
});

it("opens the presented picture in the shared viewer and keeps the row's own actions", async () => {
  const user = userEvent.setup();
  render(<DeliveryCard files={[{ path: "heart-gaps.png" }]} reply={picture()} />);
  await user.click(screen.getByRole("button", { name: "查看图片 heart-gaps.png" }));
  const dialog = screen.getByRole("dialog", { name: "heart-gaps.png" });
  expect(within(dialog).getByRole("img").getAttribute("src")).toBe("/rt/r1/workspace/image?path=heart-gaps.png");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: /^预览.*heart-gaps.png/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /更多.*heart-gaps.png/ })).toBeTruthy();
});

it("draws no picture for a file that is not an image, or where the conversation names no source", () => {
  const { container } = render(<DeliveryCard files={[{ path: "report.pdf" }]} reply={picture()} />);
  expect(container.querySelector(".delivery-picture")).toBeNull();
  cleanup();
  const bare = render(<DeliveryCard files={[{ path: "heart-gaps.png" }]} reply={actions()} />);
  expect(bare.container.querySelector(".delivery-picture")).toBeNull();
  expect(screen.getByRole("button", { name: /^预览.*heart-gaps.png/ })).toBeTruthy();
});

it("falls back to the row alone when the picture cannot load", () => {
  const { container } = render(<DeliveryCard files={[{ path: "heart-gaps.png" }]} reply={picture()} />);
  fireEvent.error(container.querySelector(".delivery-picture img")!);
  expect(container.querySelector(".delivery-picture")).toBeNull();
  expect(screen.getByRole("button", { name: /^预览.*heart-gaps.png/ })).toBeTruthy();
});
