import { t } from "../i18n";
import type { AgentPort } from "../port/port";
import { usePeers } from "./usePeers";
import { wording } from "./peerthreads";
import { StudioIcon } from "./StudioIcon";

const POLL_MS = 3000;

/** The sessions this conversation dispatched tasks to (会话互聊 peers), as one
 *  quiet chip in the meter rail. Hovering it — or focusing it — opens the small
 *  card that lists each peer and where its reply stands, the way the context
 *  chip's card does. Nothing stands between the transcript and the composer:
 *  a conversation with nothing dispatched out shows no chip at all. */
export function DispatchThreadsBar({ port, onOpen }: { port: AgentPort; onOpen?: (path: string) => void }) {
  const { state } = usePeers(port, POLL_MS);
  const threads = state.enabled ? (state.threads ?? []) : [];
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
