import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { current, t } from "../i18n";
import type { HubPort, TreeSession } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { clearDraftForSession } from "./drafts";
import { useBack } from "./back";

/** The selected rows that are still on screen; a row that leaves the displayed set leaves the selection. */
export function useSelectedRows(displayed: TreeSession[], selection: Set<string> | null, setSelection: Dispatch<SetStateAction<Set<string> | null>>): TreeSession[] {
  const key = displayed.map((row) => row.path).join("\n");
  useEffect(() => {
    const paths = new Set(key ? key.split("\n") : []);
    setSelection((current) => {
      if (!current) return current;
      const next = new Set([...current].filter((path) => paths.has(path)));
      return next.size === current.size ? current : next;
    });
  }, [key, setSelection]);
  return [...new Map(displayed.filter((row) => selection?.has(row.path)).map((row) => [row.path, row])).values()];
}

export function SessionBatch({ hub, selection, selected, displayed, onSelect, onExit, onBusy, onClose, onArchive, autoRoot, liveIds, reload, onError }: {
  hub: HubPort;
  selection: Set<string> | null;
  selected: TreeSession[];
  displayed: TreeSession[];
  onSelect: (next: Set<string> | null) => void;
  onExit: () => void;
  onBusy: (busy: boolean) => void;
  onClose: (ids: string[]) => Promise<void>;
  onArchive: (path: string, archived: boolean, runtimeId?: string) => Promise<void>;
  /** The auto workspace's root: a selected row writing there is a task
   *  conversation, and its delete takes the whole footprint. */
  autoRoot?: string;
  liveIds: (ids: string[]) => string[];
  reload: () => Promise<void>;
  onError: (e: unknown) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "archive" | "restore" | "delete">("idle");
  const wasSelecting = useRef(selection !== null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const pending = phase !== "idle" && phase !== "confirm";
  const asking = phase === "confirm";
  const liveSelected = new Set(liveIds(selected.flatMap((row) => row.runtimeId ? [row.runtimeId] : [])));
  const running = liveSelected.size > 0;
  const blocked = pending || running || selected.length === 0;
  const all = displayed.length > 0 && displayed.every((row) => selection?.has(row.path));
  const restore = selected.length > 0 && selected.every((row) => row.archived);
  const cancel = () => { setPhase("idle"); onBusy(false); deleteButton.current?.focus(); };
  useBack(phase === "confirm", cancel);
  useBack(selection !== null && phase === "idle", onExit);
  useEffect(() => {
    if (wasSelecting.current && selection === null) {
      onExit();
    }
    wasSelecting.current = selection !== null;
  }, [selection !== null]);
  useEffect(() => {
    if (phase === "idle" && selection !== null) (deleteButton.current?.disabled ? doneButton.current : deleteButton.current)?.focus();
  }, [phase, selection !== null]);

  const run = async (action: "archive" | "restore" | "delete") => {
    if (blocked) return;
    setPhase(action);
    onBusy(true);
    const failed = new Set<string>();
    let firstError: unknown;
    let removed = false;
    for (const row of selected) {
      try {
        if (row.runtimeId && liveIds([row.runtimeId]).length > 0) throw new Error(t("session.selected_sessions_are_running_stop"));
        if (action === "delete") {
          if (row.runtimeId) await onClose([row.runtimeId]);
          await hub.removeSession(row.path);
          clearDraftForSession("", row.path);
          removed = true;
        } else {
          await onArchive(row.path, action === "archive", row.runtimeId);
        }
      } catch (e) {
        failed.add(row.path);
        firstError ??= e;
      }
    }
    if (removed) {
      try { await reload(); } catch (e) { firstError ??= e; }
    }
    onSelect(failed);
    setPhase("idle");
    onBusy(false);
    if (firstError) onError(firstError);
    deleteButton.current?.focus();
  };

  // The two kinds the delete speaks about: a task conversation's footprint is
  // its own, a project conversation's sits in a folder that stays.
  const taskCount = autoRoot ? selected.filter((row) => row.workspaceRoot === autoRoot).length : 0;
  const projectCount = selected.length - taskCount;
  if (selection === null) return null;
  return (
    <div className="session-batch" aria-busy={pending}>
      <div className="session-batch-head">
        <button data-action="session.selection" data-value={all ? "clear" : "all"} disabled={phase !== "idle" || displayed.length === 0}
          aria-label={t(all ? "session.deselect_displayed_sessions" : "session.select_all_displayed_sessions")}
          onClick={() => {
            const next = new Set(selection);
            for (const row of displayed) { if (all) next.delete(row.path); else next.add(row.path); }
            onSelect(next);
          }}>{t(all ? "session.deselect_everything" : "session.select_all")}</button>
        <span role="status">{t("session.n_sessions_selected", { n: selected.length })}</span>
        <button ref={doneButton} className="x" data-action="session.selection" data-value="end" disabled={pending}
          aria-label={t("session.done_selecting")} title={t("session.done_selecting")}
          onClick={() => { cancel(); onSelect(null); }}><StudioIcon name="close" /></button>
      </div>
      <div className="session-batch-actions">
        <button data-action="session.batch-archive" data-value={restore ? "restore" : "archive"} disabled={blocked || asking}
          aria-label={t(restore ? "session.unarchive_selected_sessions" : "session.archive_selected_sessions")} onClick={() => void run(restore ? "restore" : "archive")}>{t(restore ? "common.unarchive" : "common.archived_2")}</button>
        <button ref={deleteButton} className="danger" data-action="session.batch-delete" disabled={blocked || asking} aria-label={t("session.delete_selected_sessions")}
          onClick={() => { setPhase("confirm"); onBusy(true); }}>{t("common.delete")}</button>
      </div>
      {running && <p>{t("session.selected_sessions_are_running_stop")}</p>}
      {pending && <p role="status">{t("session.processing_selected_sessions")}</p>}
      {phase === "confirm" && (
        <div className="wsconfirm" role="alertdialog" aria-label={t("session.delete_n_sessions", { n: selected.length })}
          data-action-keydown="layer.dismiss" onKeyDown={(ev) => { if (ev.key === "Escape") { ev.stopPropagation(); cancel(); } }}>
          <div className="wsconfirm-t">
            <span className="q">{t("session.delete_n_sessions", { n: selected.length })}</span>
            <span className="session-batch-names">{selected.map((row) => row.title || row.name).join(current() === "zh" ? "、" : ", ")}</span>
            {taskCount > 0 && <span className="h">{t("session.batch_delete_tasks_hint", { n: taskCount })}</span>}
            {projectCount > 0 && <span className="h">{t("session.batch_delete_projects_hint", { n: projectCount })}</span>}
          </div>
          <div className="wsconfirm-a">
            <button autoFocus data-action="layer.dismiss" onClick={cancel}>{t("common.cancel")}</button>
            <button data-action="session.batch-delete" data-danger="" disabled={blocked} onClick={() => void run("delete")}>{t("common.delete")}</button>
          </div>
        </div>
      )}

    </div>
  );
}
