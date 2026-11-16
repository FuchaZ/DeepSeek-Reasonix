import type { TreeWorkspace } from "../port/hub";
import type { HubPort } from "../port/hub";

/** Everything a removal needs from the pane that hosts the tree. */
export interface WorkspaceRemovalDeps {
  hub: Pick<HubPort, "removeWorkspace">;
  tree: TreeWorkspace[];
  panesOf(root: string): string[];
  liveIds(ids: string[]): string[];
  onClose(ids: string[]): Promise<void>;
  reload(): Promise<void>;
  onError(e: unknown): void;
}

// The removal flows share one pane-first rule: a pane that is mid-turn keeps
// its folder, the ones that are not close first, and the kernel call follows.
export function workspaceRemoval(deps: WorkspaceRemovalDeps) {
  const removeWorkspaceNow = async (ws: TreeWorkspace) => {
    // Closed here for the same reason dropSession does it: the kernel will not
    // pull a folder out from under a pane that is writing, and leaving that to
    // the reader only means asking which of eight tabs belong to this one.
    const open = deps.panesOf(ws.root);
    if (open.length && deps.liveIds(open).length === 0) await deps.onClose(open);
    await deps.hub.removeWorkspace(ws.root);
  };

  // The batch bar asks once about every project at once; each one then leaves
  // the list through the same flow a single removal does. A refusal keeps the
  // others going, and the tree is read once for the whole batch.
  const removeAll = async (roots: string[]) => {
    let firstError: unknown;
    let removed = false;
    for (const root of roots) {
      const ws = deps.tree.find((w) => w.root === root);
      if (!ws) continue;
      try {
        await removeWorkspaceNow(ws);
        removed = true;
      } catch (e) {
        firstError ??= e;
      }
    }
    if (removed) {
      try { await deps.reload(); } catch (e) { firstError ??= e; }
    }
    if (firstError) deps.onError(firstError);
  };

  return { removeWorkspaceNow, removeAll };
}
