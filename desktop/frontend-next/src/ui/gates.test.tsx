// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useGateActions } from "./gates";

// Switching to full access answers only the cards the new posture covers. A
// fresh decision — a dispatch, a peer message, a setting — stays on the queue
// whatever the posture, and the window must keep showing it: marking it settled
// hid a card nobody had answered, and the turn waited for a reply that could
// never come.

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
  it("marks a card the kernel actually let through", async () => {
    const { actions, dispatch } = setup(["i1"]);
    await actions.onFullAccess("i1");
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ id: "i1", verdict: "yolo" }));
  });

  it("leaves a fresh decision on the queue", async () => {
    const { actions, dispatch } = setup([]);
    await actions.onFullAccess("i1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not guess when the answer says nothing", async () => {
    const { actions, dispatch } = setup(undefined);
    await actions.onFullAccess("i1");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reports a switch that failed instead of settling anything", async () => {
    const { actions, port, dispatch, fail } = setup([]);
    const boom = new Error("busy");
    port.setApprovalMode.mockRejectedValueOnce(boom);
    await actions.onFullAccess("i1");
    expect(fail).toHaveBeenCalledWith(boom);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
