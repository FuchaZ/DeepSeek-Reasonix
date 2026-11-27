// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { langOf } from "./fileKind";
import { leave, useEnteringTabs } from "./workbench_motion";
import { WorkbenchTabPicker } from "./WorkbenchTabPicker";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("tabs that move, as the WB-Frame board draws them", () => {
  it("brings in a tab that opened after the strip was drawn, and not the ones drawn with it", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ keys }) => useEnteringTabs(keys), { initialProps: { keys: ["file:a", "file:b"] } });
    expect([...result.current]).toEqual([]);
    rerender({ keys: ["file:a", "file:b", "browser:t1"] });
    expect([...result.current]).toEqual(["browser:t1"]);
    act(() => void vi.advanceTimersByTime(300));
    expect([...result.current]).toEqual([]);
  });

  it("closes at once where there is nothing to animate with", () => {
    const then = vi.fn();
    leave(document.createElement("div"), then);
    expect(then).toHaveBeenCalled();
  });

  it("colours Go, Python and sheets apart and leaves the rest alone", () => {
    expect(["a/b.go", "x.py", "q3.xlsx", "data.csv", "README.md"].map(langOf)).toEqual(["go", "python", "sheet", "sheet", undefined]);
  });

  it("lists every open tab to jump from, and marks the one showing", async () => {
    // Drawn even when the strip fits: the tail of a strip is out of reach the
    // moment two more files are opened, and closing tabs to get at one is not
    // a way to reach it.
    const onPick = vi.fn();
    render(<WorkbenchTabPicker
      tabs={[{ key: "file:a", label: "a.go" }, { key: "file:b", label: "b.go" }, { key: "browser:t1", label: "Browser" }]}
      active="file:b" onPick={onPick} />);

    await userEvent.click(screen.getByRole("button", { name: "切换到某个标签" }));
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((row) => row.textContent)).toEqual(["a.go", "b.go", "Browser"]);
    expect(rows[1].getAttribute("aria-current"), "the showing tab is the one marked").toBe("true");
    expect(rows[0].getAttribute("aria-current")).toBeNull();

    await userEvent.click(rows[2]);
    expect(onPick).toHaveBeenCalledWith("browser:t1");
    expect(screen.queryByRole("menu"), "picking closes the list").toBeNull();
  });

  it("has nothing to list before a tab is open", () => {
    const { container } = render(<WorkbenchTabPicker tabs={[]} active="" onPick={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("ticks only the row that is showing", async () => {
    // Six tabs called "about:blank" carry no wording to compare, so the row
    // that is open has to be said without reading the names. This asserts what
    // the DOM can answer — one row carries `aria-current`, and every row has
    // the tick element for the stylesheet to reveal or hide.
    const tabs = Array.from({ length: 6 }, (_, i) => ({ key: `browser:t${i}`, label: "about:blank" }));
    render(<WorkbenchTabPicker tabs={tabs} active="browser:t3" onPick={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "切换到某个标签" }));

    const rows = screen.getAllByRole("menuitem");
    expect(rows).toHaveLength(6);
    const marked = rows.filter((row) => row.querySelector(".workbench-picker-mark"));
    expect(marked, "every row carries the icon").toHaveLength(6);
    const shown = rows.filter((row) => row.getAttribute("aria-current") === "true");
    expect(shown, "one row is the current one").toHaveLength(1);
    expect(shown[0], "and it is the fourth").toBe(rows[3]);
  });
});
