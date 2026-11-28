import { t } from "../i18n";
import type { TreeSession, TreeWorkspace } from "../port/hub";

export const parentOf = (root: string) => root.replace(/[/\\]+$/, "").split(/[/\\]/).slice(-2, -1)[0] ?? "";

// A conversation a pane holds before its first turn is written has only a file
// name; calling it that would show a timestamp where every other row shows words.
export const rowLabel = (session: TreeSession) =>
  session.title || (session.runtimeId && !session.turns ? t("common.new_session") : session.name);

// The drag payload of a group-label reorder: only drags that carry it move a
// run, the way the row reorder carries its own kind.
export const GROUP_DRAG_KIND = "application/x-reasonix-group";
// A conversation row carries its own kind, so a row can never drop onto a
// group label or a label onto a row: the kinds keep the two gestures apart.
export const SESSION_DRAG_KIND = "application/x-reasonix-session";

/** Project folders the header control acts on: the task run has no folder rows,
 *  and its own label already folds its conversations. */
export function projectFoldRoots(projects: TreeWorkspace[], hasKids: (ws: TreeWorkspace) => boolean) {
  return projects.filter((ws) => !ws.auto && hasKids(ws)).map((ws) => ws.root);
}

export function allFolded(roots: string[], folded: Set<string>) {
  return roots.length > 0 && roots.every((root) => folded.has(root));
}
