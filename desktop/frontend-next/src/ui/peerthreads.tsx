import { createContext, useCallback, useContext, useEffect, useMemo, type MouseEvent, type ReactNode } from "react";
import { t } from "../i18n";
import type { PeerThread } from "../port/boundary";
import type { AgentPort } from "../port/port";
import { usePeers } from "./usePeers";

interface Threads {
  by: ReadonlyMap<string, PeerThread>;
  open: (path: string) => void;
}

const NONE: Threads = { by: new Map(), open: () => {} };
const PeerThreadsContext = createContext<Threads>(NONE);

/** The sessions this one has written to, keyed by the peer's transcript path.
 *  The kernel's ledger decides each state; the tree-change event that already
 *  moves held messages is what asks for a new reading. */
export function PeerThreadsProvider({ port, hub, onOpen, children }: {
  port: AgentPort | null;
  hub: { onTreeChanged?: (listener: () => void) => () => void };
  onOpen: (path: string) => void;
  children: ReactNode;
}) {
  const { state, refresh } = usePeers(port, 0);
  useEffect(() => hub.onTreeChanged?.(() => void refresh()), [hub, refresh]);
  const by = useMemo(() => {
    const map = new Map<string, PeerThread>();
    if (state.enabled) for (const th of state.threads ?? []) if (th.sessionPath) map.set(th.sessionPath, th);
    return map;
  }, [state]);
  const value = useMemo(() => ({ by, open: onOpen }), [by, onOpen]);
  return <PeerThreadsContext.Provider value={value}>{children}</PeerThreadsContext.Provider>;
}

/** The state of one exchange, as the person here reads it. `name` lets a caller
 *  show the role the sender opened the session under instead of its title, and
 *  `project` stands in where the wire named none — a peer that has gone quiet
 *  keeps neither on the trail. */
export function wording(th: PeerThread, name = th.title, project?: string): string {
  const p = { title: name, project: project ?? th.project ?? t("chat.dispatch_thread_unknown_project") };
  switch (th.state) {
    case "waiting": return t("remote.sent_to_title_project_waiting", p);
    case "working": return t("remote.title_project_accepted_it_and", p);
    case "replied": return t("remote.title_project_replied_to_you", p);
    case "declined": return t("remote.the_user_of_title_project", p);
  }
}

/** One small icon on the row or tab of a session this one has written to. */
export function PeerThreadMark({ path }: { path?: string }) {
  const { by, open } = useContext(PeerThreadsContext);
  const th = path ? by.get(path) : undefined;
  const go = useCallback((ev: MouseEvent) => {
    ev.stopPropagation();
    if (th?.sessionPath) open(th.sessionPath);
  }, [th, open]);
  if (!th) return null;
  const label = wording(th);
  // A lamp, not an icon: the state is read at a glance from the sidebar, and the
  // shape carries it even where colour is hard to tell apart. waiting turns, so
  // "nobody has picked it up" looks unlike "they are on it".
  return (
    <button type="button" className="peerthread" data-state={th.state} data-action="peer.thread-open" title={label} aria-label={label} onClick={go}>
      <i className="peerthread-lamp" aria-hidden="true" />
    </button>
  );
}
