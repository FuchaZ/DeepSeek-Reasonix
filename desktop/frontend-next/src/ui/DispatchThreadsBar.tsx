import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { DispatchBoardRow, HubPort } from "../port/hub";
import { StudioIcon } from "./StudioIcon";

const POLL_MS = 3000;

const STATE_KEY: Record<DispatchBoardRow["state"], string> = {
  waiting: "chat.dispatch_board_state_waiting",
  working: "chat.dispatch_board_state_working",
  replied: "chat.dispatch_board_state_replied",
  declined: "chat.dispatch_board_state_declined",
};

/** The whole machine's dispatches, read once per poll and again whenever the
 *  tree changes. A hub without the route (an older one) draws nothing rather
 *  than reporting a record of its own: the board is the only surface that
 *  knows an end was archived or removed, and a sender's record outlives both. */
function useDispatchBoard(hub?: Pick<HubPort, "dispatchBoard" | "onTreeChanged">) {
  const [rows, setRows] = useState<DispatchBoardRow[]>([]);
  const alive = useRef(true);
  // One read at a time: a host still answering the last poll must not be
  // handed another, or a slow board becomes a queue of them.
  const inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (!hub || inFlight.current) return;
    inFlight.current = true;
    try {
      const next = await hub.dispatchBoard();
      if (alive.current) setRows(next);
    } catch {
      /* the chip keeps its last view */
    } finally {
      inFlight.current = false;
    }
  }, [hub]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const off = hub?.onTreeChanged?.(() => void refresh());
    const timer = hub
      ? setInterval(() => { if (typeof document === "undefined" || !document.hidden) void refresh(); }, POLL_MS)
      : null;
    return () => { alive.current = false; off?.(); if (timer) clearInterval(timer); };
  }, [refresh, hub]);
  return rows;
}

/** The whole machine's dispatches, as one quiet chip in the meter rail beside
 *  对话轮次. Hovering or focusing it opens a small card — anchored above the
 *  chip, never a full-screen layer — with both ends named, the role the sender
 *  gave, and the state lamp, split into this project and cross-project. The
 *  board decides what is still live, so a conversation with nothing dispatched
 *  out, or one whose ends are gone, shows no chip at all. */
export function DispatchThreadsBar({ hub, onOpen }: {
  hub?: Pick<HubPort, "dispatchBoard" | "onTreeChanged">;
  onOpen?: (path: string) => void;
}) {
  const rows = useDispatchBoard(hub);
  if (rows.length === 0) return null;
  const go = (path?: string) => { if (path) onOpen?.(path); };
  const row = (r: DispatchBoardRow, i: number) => {
    const stateText = t(STATE_KEY[r.state]);
    const unnamed = t("chat.dispatch_thread_unnamed");
    return (
      <div className="peerrow" key={`${r.dispatcher.sessionPath}-${r.assignee.sessionPath}-${i}`}>
        <button type="button" className="peername" title={r.dispatcher.sessionPath}
          onClick={() => go(r.dispatcher.sessionPath)}>{r.dispatcher.title || r.role || unnamed}</button>
        <span className="boardarrow" aria-hidden="true">→</span>
        <button type="button" className="peerstate-name" title={r.assignee.sessionPath}
          onClick={() => go(r.assignee.sessionPath)}>{r.assignee.title || r.role || unnamed}</button>
        {r.role && <span className="peerrole" title={r.role}>{r.role}</span>}
        <span className="peerthread" data-state={r.state} title={stateText} aria-label={stateText}>
          <i className="peerthread-lamp" aria-hidden="true" />
        </span>
        <span className="peerstate">{stateText}</span>
      </div>
    );
  };
  const group = (title: string, list: DispatchBoardRow[]) => list.length === 0 ? null : (
    <div className="peergroup"><h4>{title}</h4>{list.map(row)}</div>
  );
  const here = rows.filter((r) => !r.crossProject);
  const across = rows.filter((r) => r.crossProject);
  return (
    <span className="studio-peers-anchor">
      <button type="button" className="studio-meter-peers" data-action="metrics.details" data-value="peers" aria-haspopup="dialog"
        aria-label={t("chat.dispatch_board_title")} title={t("chat.dispatch_threads_count", { n: rows.length })}>
        <StudioIcon name="send" /><span>{t("chat.dispatch_threads_title")}</span><b>{rows.length}</b>
      </button>
      <div className="studio-peers-detail" role="dialog" aria-label={t("chat.dispatch_board_title")}>
        <header><b>{t("chat.dispatch_board_title")}</b><small>{t("chat.dispatch_threads_count", { n: rows.length })}</small></header>
        {group(t("chat.dispatch_board_this_project"), here)}
        {group(t("chat.dispatch_board_cross_project"), across)}
      </div>
    </span>
  );
}
