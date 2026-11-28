// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "./testkit";
import { Fold } from "./Fold";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("a folding row set", () => {
  it("paints through the close, then leaves the DOM, and comes back at once on open", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Fold open><p>rows</p></Fold>);
    const grid = container.querySelector<HTMLElement>(".foldgrid")!;
    expect(grid.hasAttribute("data-open")).toBe(true);
    expect(screen.getByText("rows")).toBeTruthy();

    rerender(<Fold open={false}><p>rows</p></Fold>);
    expect(grid.hasAttribute("data-open")).toBe(false);
    expect(grid.getAttribute("aria-hidden")).toBe("true");
    expect(grid.hasAttribute("inert")).toBe(true);
    expect(screen.getByText("rows")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.queryByText("rows")).toBeNull();

    rerender(<Fold open><p>rows</p></Fold>);
    expect(screen.getByText("rows")).toBeTruthy();
    expect(grid.hasAttribute("data-open")).toBe(true);
  });
});
