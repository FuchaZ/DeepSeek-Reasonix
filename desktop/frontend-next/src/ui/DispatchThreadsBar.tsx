import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import type { DispatchBoardRow, HubPort } from "../port/hub";
import type { AgentPort } from "../port/port";
import { usePeers } from "./usePeers";
import { wording } from "./peerthreads";
import { StudioIcon } from "./StudioIcon";

const POLL_MS = 3000;

const BOARD_STATE_KEY: Record<DispatchBoardRow["state"], string> = {
  waiting: "chat.dispatch_board_state_waiting",
  working: "chat.dispatch_board_state_working",
  replied: "chat.dispatch_board_state_replied",
  declined: "chat.dispatch_board_state_declined",
};

/** The board rows, once per poll. A hub without the route (an older one) leaves
 *  the chip on the sender's own record instead of blanking it. */
function useDispatchBoard(hub?: Pick<HubPort, "dispatchBoard">) {
  const [rows, setRows] = useState<DispatchBoardRow[]>([]);
  const alive = useRef(true);
  const refresh = useCallback(async () => {
    if (!hub) return;
    try {
      const next = await hub.dispatchBoard();
      if (alive.current) setRows(next);
    } catch {
      /* the chip keeps its last view */
    }
  }, [hub]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = hub
      ? setInterval(() => { if (typeof document === "undefined" || !document.hidden) void refresh(); }, POLL_MS)
      : null;
    return () => { alive.current = false; if (timer) clearInterval(timer); };
  }, [refresh, hub]);
  return rows;
}

/** The whole machine's dispatches, grouped by whether the two ends share a
 *  project. Both ends are named and each is a way into that session; the lamp
 *  and its words say where the task stands. */
function CollaborationBoard({ rows, onOpen }: { rows: DispatchBoardRow[]; onOpen?: (path: string) => void }) {
  const go = (path?: string) => { if (path) onOpen?.(path); };
  const row = (r: DispatchBoardRow, i: number) => {
    const stateText = t(BOARD_STATE_KEY[r.state]);
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

/** The sessions this conversation dispatched tasks to (会话协作 peers), as one
 *  quiet chip in the meter rail. The hub's board is the authority for what is
 *  still live — it drops an archived or removed end — and a hub that predates
 *  the board falls back to the sender's own record. Nothing stands between the
 *  transcript and the composer: a conversation with nothing dispatched out
 *  shows no chip at all. */
export function DispatchThreadsBar({ port, hub, onOpen }: {
  port: AgentPort;
  hub?: Pick<HubPort, "dispatchBoard">;
  onOpen?: (path: string) => void;
}) {
  const { state } = usePeers(port, POLL_MS);
  const board = useDispatchBoard(hub);
  const threads = state.enabled ? (state.threads ?? []) : [];
  if (board.length > 0) return <CollaborationBoard rows={board} onOpen={onOpen} />;
  if (threads.length === 0) return null;
  return (
    <span className="studio-peers-anchor">
      <button type="button" className="studio-meter-peers" data-action="metrics.details" data-value="peers" aria-haspopup="dialog"
        aria-label={t("chat.dispatch_threads_title")} title={t("chat.dispatch_threads_count", { n: threads.length })}>
        <StudioIcon name="send" /><span>{t("chat.dispatch_threads_title")}</span><b>{threads.length}</b>
      </button>
      <div className="studio-peers-detail" role="dialog" aria-label={t("chat.dispatch_threads_title")}>
        <header><b>{t("chat.dispatch_threads_title")}</b><small>{t("chat.dispatch_threads_count", { n: threads.length })}</small></header>
        {threads.map((th) => {
          // A peer that has gone quiet keeps no name on the wire — the audit
          // trail carries keys, not titles — so an unknown reads as its own
          // word instead of the word "undefined".
          const name = th.role || th.title || t("chat.dispatch_thread_unnamed");
          const state = wording(th, name);
          const go = () => { if (th.sessionPath) onOpen?.(th.sessionPath); };
          return (
            <div className="peerrow" key={th.key}>
              <span className="peername">{t("chat.dispatch_thread_handling", { title: name })}</span>
              <span className="peerstate">{state}</span>
              {th.sessionPath && (
                <button type="button" className="peerthread" data-state={th.state} data-action="peer.thread-open"
                  data-session-path={th.sessionPath} title={state} aria-label={state} onClick={go}>
                  <i className="peerthread-lamp" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </span>
  );
}
