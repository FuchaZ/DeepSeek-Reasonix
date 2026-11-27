import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { DispatchThread, HubPort, TreeSession, TreeWorkspace } from "../port/hub";
import { StudioIcon } from "./StudioIcon";
import { zoom } from "./place";
import { useBack } from "./back";

const stampOf = (ms: number | undefined) => {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** The card a session row's hover opens: the conversation's own facts — title,
 *  project, folder, last move — and, where the hub's book remembers dispatches
 *  out of it, one line per task with the session it landed on, each opening
 *  that session. Same project or across projects: the book belongs to the
 *  sender, so a closed pane still answers. */
export function SessionHoverCard({ hub, ws, session, anchor, onClose, onOpenSession, onKeepOpen }: {
  hub: HubPort;
  ws: TreeWorkspace;
  session: TreeSession;
  anchor: DOMRect;
  onClose: () => void;
  onOpenSession: (path: string) => void;
  onKeepOpen: () => void;
}) {
  useBack(true, onClose);
  const [threads, setThreads] = useState<DispatchThread[] | null>(null);
  useEffect(() => {
    let alive = true;
    // Hubs without the book answer empty: the guard keeps a test's ad-hoc
    // hub from throwing inside the effect.
    const call = hub.dispatchThreads?.(session.path);
    void Promise.resolve(call)
      .then((got) => { if (alive) setThreads(got ?? []); })
      .catch(() => { if (alive) setThreads([]); });
    return () => { alive = false; };
  }, [hub, session.path]);
  const title = session.title?.trim() || session.name;
  const stamp = stampOf(session.lastActiveAt);
  // The rect reads in screen pixels; the card's fixed position lives inside
  // the page's zoom, so the anchor is divided by it — the same math pinning
  // the other floaters uses.
  const z = zoom();
  const left = Math.min(anchor.right + 10, window.innerWidth - 316) / z;
  const top = Math.max(12, Math.min(anchor.top, window.innerHeight - 220)) / z;
  return createPortal(
    <div className="sesscard" role="dialog" aria-label={title}
      style={{ left, top }}
      onMouseEnter={onKeepOpen} onMouseLeave={onClose}>
      <b className="sesscard-title">{title}</b>
      <div className="sesscard-line"><span>{t("common.project")}</span>{ws.name}</div>
      <div className="sesscard-line" title={ws.root}>{ws.root}</div>
      {stamp && <div className="sesscard-line"><span>{t("session.hover_updated_at")}</span>{stamp}</div>}
      {threads && threads.length > 0 && (
        <div className="sesscard-threads">
          {threads.map((th, i) => (
            <button key={th.sessionPath ?? th.key ?? i} type="button" data-action="peer.thread-open"
              data-session-path={th.sessionPath}
              onClick={() => { if (th.sessionPath) { onClose(); onOpenSession(th.sessionPath); } }}>
              <i aria-hidden="true" />
              <span>{t("chat.dispatch_thread_handling", { title: th.role || t("chat.dispatch_thread_unnamed") })}</span>
            </button>
          ))}
        </div>
      )}
      <button type="button" className="sesscard-open" data-action="session.open"
        onClick={() => { onClose(); onOpenSession(session.path); }}>
        <StudioIcon name="arrowRight" /><span>{t("session.hover_open_session")}</span>
      </button>
    </div>,
    document.body,
  );
}
