import type { TreeSession, TreeWorkspace } from "../port/hub";

export interface WorkspaceGroups {
  projects: TreeWorkspace[];
  tasks: TreeWorkspace[];
}

/** Toggles one path inside an active selection; no-op when picking is off. */
export function togglePath(current: Set<string> | null, path: string): Set<string> | null {
  if (!current) return current;
  const next = new Set(current);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

/** Picks or clears every row a folder currently shows, the way its checkbox
 *  reads: all in, or all out. */
export function pickVisible(current: Set<string> | null, rows: TreeSession[]): Set<string> | null {
  if (!current) return current;
  const next = new Set(current);
  const all = rows.length > 0 && rows.every((row) => next.has(row.path));
  for (const row of rows) {
    if (all) next.delete(row.path);
    else next.add(row.path);
  }
  return next;
}

/** Splits the tree into the two runs the sidebar draws, each keeping the order
 *  it was given: folders a person works in are 项目, and the app's own folder —
 *  the kernel marks it auto — is 任务, where a conversation with no project
 *  lands. Every other folder shows as a project row, remembered or not, so a
 *  pane's open workspace is never missing from the tree. */
export function workspaceGroups(tree: TreeWorkspace[]): WorkspaceGroups {
  return {
    projects: tree.filter((ws) => !ws.auto),
    tasks: tree.filter((ws) => !!ws.auto),
  };
}

/** How a group head reads and writes the fold: the roots it governs are the
 *  run's rows that can fold at all, and the head counts as folded only when
 *  every one of them is — the same rows' chevrons read this set back. */
export interface GroupFold {
  roots: string[];
  canFold: boolean;
  folded: boolean;
}

export function groupFold(list: TreeWorkspace[], folded: Set<string>, canFoldRow: (ws: TreeWorkspace) => boolean): GroupFold {
  const roots = list.filter(canFoldRow).map((ws) => ws.root);
  return { roots, canFold: roots.length > 0, folded: roots.length > 0 && roots.every((root) => folded.has(root)) };
}
