// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "./testkit";
import { TreeReading } from "./TreeReading";
import { Workspaces } from "./Workspaces";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function draw(treeRead: boolean, retry?: () => void) {
  return (
    <Workspaces
      hub={{} as never}
      tree={[]}
      treeRead={treeRead}
      runtimes={[]}
      active=""
      folded={new Set()}
      onFold={() => {}}
      reload={async () => {}}
      retry={retry}
      onOpen={async () => {}}
      onFocus={() => {}}
      onClose={async () => {}}
      liveIds={() => []}
      runs={{}}
      onRename={() => {}}
      onError={() => {}}
      adder={{ add: () => {}, close: () => {}, at: null } as never}
    />
  );
}

it("counts the seconds the first tree read has been pending", () => {
  render(draw(false));
  expect(screen.getByText("正在读取文件夹…")).toBeTruthy();
  expect(screen.queryByText(/^\ds$/)).toBeNull();
  act(() => vi.advanceTimersByTime(3000));
  expect(screen.getByText("3s")).toBeTruthy();
  act(() => vi.advanceTimersByTime(2000));
  expect(screen.getByText("5s")).toBeTruthy();
});

it("keeps the ticking seconds out of the status announcement", () => {
  render(draw(false));
  act(() => vi.advanceTimersByTime(3000));
  const status = screen.getByRole("status");
  expect(screen.getByText("3s").getAttribute("aria-hidden")).toBe("true");
  expect(status.contains(screen.getByText("3s"))).toBe(true);
});

it("drops the clock once the read settles", () => {
  const { rerender } = render(draw(false));
  act(() => vi.advanceTimersByTime(3000));
  rerender(draw(true));
  expect(screen.queryByText("3s")).toBeNull();
  expect(screen.queryByText("正在读取文件夹…")).toBeNull();
  // A settled empty tree is two standing runs, each saying it holds nothing.
  expect(screen.getByText("暂无项目")).toBeTruthy();
  expect(screen.getByText("暂无任务")).toBeTruthy();
  expect(vi.getTimerCount()).toBe(0);
});

it("clears its interval on unmount", () => {
  const { unmount } = render(<TreeReading />);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("says nothing about a retry while the read is young", () => {
  render(draw(false, () => {}));
  act(() => vi.advanceTimersByTime(14_000));
  expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
});

it("after fifteen seconds says it is still reading and offers a retry, once", () => {
  const retry = vi.fn();
  render(draw(false, retry));
  act(() => vi.advanceTimersByTime(15_000));
  expect(screen.getByText(/仍在读取/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it("restarts its clock when the retry is pressed, so the wait it describes is the new request's", () => {
  render(draw(false, () => {}));
  act(() => vi.advanceTimersByTime(16_000));
  fireEvent.click(screen.getByRole("button", { name: "重试" }));
  expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
  expect(screen.queryByText(/仍在读取/)).toBeNull();
  act(() => vi.advanceTimersByTime(15_000));
  expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
});

it("offers no retry where the window has none to run", () => {
  render(draw(false));
  act(() => vi.advanceTimersByTime(20_000));
  expect(screen.queryByRole("button", { name: "重试" })).toBeNull();
});
