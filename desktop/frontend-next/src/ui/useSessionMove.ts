import { useCallback } from "react";
import type { HubPort, TreeSession, TreeWorkspace } from "../port/hub";

/** Moving a conversation one place up or down in its project's list. The list is
 *  the kernel's, so after a move the tree is asked for again rather than patched
 *  here; while a search narrows the list there is no order to move within. */
export function useSessionMove(hub: HubPort, reload: () => Promise<void>, onError: (e: unknown) => void, searching: boolean) {
  const canMove = useCallback((ws: TreeWorkspace, session: TreeSession) => {
    const peers = ws.sessions.filter((s) => !!s.archived === !!session.archived);
    const at = peers.indexOf(session);
    return { up: !searching && at > 0, down: !searching && at >= 0 && at < peers.length - 1 };
  }, [searching]);
  const move = useCallback(async (session: TreeSession, direction: -1 | 1) => {
    try {
      await hub.moveSession(session.path, direction);
      await reload();
    } catch (e) {
      onError(e);
    }
  }, [hub, reload, onError]);
  /** Drag-and-drop names the edge the line showed, not just a row: `before`
   *  seats the dragged one above the target, `after` below it, whichever way
   *  the walk has to run. The kernel swaps one place at a time, so the walk
   *  repeats it — one reload after the whole gesture, not one per step. */
  const moveTo = useCallback(async (session: TreeSession, peers: TreeSession[], target: TreeSession, edge: "before" | "after") => {
    const from = peers.indexOf(session);
    const to = peers.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    const at = edge === "before" ? (from < to ? to - 1 : to) : (from < to ? to : to + 1);
    const steps = at - from;
    if (steps === 0) return;
    try {
      for (let n = 0; n < Math.abs(steps); n++) await hub.moveSession(session.path, steps > 0 ? 1 : -1);
      await reload();
    } catch (e) {
      onError(e);
    }
  }, [hub, reload, onError]);
  return { canMove, move, moveTo };
}
