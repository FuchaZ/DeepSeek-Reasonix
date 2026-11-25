// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGateActions } from "./gates";

// "Confirm full access" is one decision, not two. The switch covers the cards
// the new posture allows; a card it does not cover — a command that runs
// another command — is answered by the same click, because that is what the
// button says it does. Leaving it for a second click read as the first one
// having failed.

const setup = (drained: string[] | undefined) => {
  const port = {
    setApprovalMode: vi.fn(async () => drained ?? []),
    approve: vi.fn(async () => {}),
  };
  const dispatch = vi.fn();
  const refreshStatus = vi.fn();
  const fail = vi.fn();
  const { result } = renderHook(() =>
    useGateActions({ port: port as never, dispatch, refreshStatus, fail, onRevise: vi.fn() }),
  );
  return { actions: result.current, port, dispatch, refreshStatus, fail };
};

describe("full access", () => {
  it("marks a card the switch itself covered", async () => {
    // The switch answers by approval id; the row's id is a local one.
    const { actions, port, dispatch } = setup(["a1"]);
    await expect(actions.onFullAccess("i1", "a1")).resolves.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "i1", verdict: "yolo" }));
    expect(port.approve).not.toHaveBeenCalled();
  });

  it("answers a card the switch did not cover, so one click settles it", async () => {
    const { actions, port, dispatch } = setup([]);
    await expect(actions.onFullAccess("i1", "a1")).resolves.toBe(true);
    expect(port.approve).toHaveBeenCalledExactlyOnceWith("a1", "once");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "i1", verdict: "yolo" }));
  });

  it("keeps the card when there is no approval id to answer", async () => {
    const { actions, port, dispatch } = setup([]);
    // Nothing to settle: marking it here would hide a card nobody answered.
    await expect(actions.onFullAccess("i1")).resolves.toBe(false);
    expect(port.approve).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports a switch that failed instead of settling anything", async () => {
    const { actions, port, dispatch, fail } = setup([]);
    const boom = new Error("busy");
    port.setApprovalMode.mockRejectedValueOnce(boom);
    await expect(actions.onFullAccess("i1", "a1")).rejects.toBe(boom);
    expect(fail).toHaveBeenCalledWith(boom);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports a card that could not be answered, without claiming it was", async () => {
    const { actions, port, dispatch, fail } = setup([]);
    const boom = new Error("already decided");
    port.approve.mockRejectedValueOnce(boom);
    await expect(actions.onFullAccess("i1", "a1")).rejects.toBe(boom);
    expect(fail).toHaveBeenCalledWith(boom);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
