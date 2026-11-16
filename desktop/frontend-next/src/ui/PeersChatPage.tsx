import { useEffect, useState, type KeyboardEvent } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { HubPort } from "../port/hub";
import type { AgentPort, PeersSettings, PeersSettingsEdit } from "../port/port";
import type { useRuntimeReload } from "./RuntimeReload";
import { PeersSection } from "./PeersSection";
import { SectionCard } from "./SectionCard";
import { SessionRef } from "./SessionRef";
import { SettingRow } from "./SettingRow";
import { StudioIcon } from "./StudioIcon";
import { SubagentClaims } from "./SubagentClaims";

// The session cross-chat page: whether the user's own sessions talk to each
// other and where that stops, the ceilings on handing a task over, and — read
// by a rebuild — how much a quote carries and how a sub-agent holds its claim.
// The reload control is the pane's one instance, handed down: a second hook
// would offer a second reload whose states nobody else could see.
export function PeersChatPage({ port, hub, onChanged, reload }: {
  port: AgentPort;
  hub: Pick<HubPort, "tree">;
  onChanged: () => void;
  reload: ReturnType<typeof useRuntimeReload>;
}) {
  return (
    <>
      <SectionCard title={t("settings.session_cross_chat")}>
        <PeersSection port={port} hub={hub} />
        <PeersLimits port={port} />
      </SectionCard>
      <SectionCard title={t("settings.collaboration")}>
        <SessionRef port={port} />
        <SubagentClaims port={port} onChanged={onChanged} />
      </SectionCard>
      <div className="ext-foot" role="note">
        <StudioIcon name="refresh" />
        <span>{t("settings.after_changing_a_setting_that")}</span>
        {reload.action}
      </div>
      {reload.note}
    </>
  );
}

// The two dispatch ceilings, saved through the same switches the block above
// writes; zero lifts a ceiling. Each field commits on blur — typing is not a
// save — and what the kernel keeps comes back to the box.
function PeersLimits({ port }: { port: AgentPort }) {
  const [state, setState] = useState<PeersSettings | null>(null);
  const [depth, setDepth] = useState("");
  const [sessions, setSessions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    port.peersSettings().then((s) => {
      if (!alive) return;
      setState(s);
      setDepth(String(s.max_dispatch_depth));
      setSessions(String(s.max_dispatched_sessions));
    }).catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [port]);

  const save = async (edit: PeersSettingsEdit, redraw: (s: PeersSettings) => void) => {
    setBusy(true);
    setError("");
    try {
      const next = await port.savePeersSettings(edit);
      setState(next);
      redraw(next);
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = (draft: string, field: "max_dispatch_depth" | "max_dispatched_sessions") => {
    if (!state) return;
    const n = Number(draft);
    if (draft === "" || !Number.isInteger(n) || n < 0) return setError(t("settings.enter_a_whole_number_0_or_more"));
    if (n === state[field]) return;
    void save(field === "max_dispatch_depth" ? { max_dispatch_depth: n } : { max_dispatched_sessions: n },
      (s) => (field === "max_dispatch_depth" ? setDepth(String(s.max_dispatch_depth)) : setSessions(String(s.max_dispatched_sessions))));
  };

  const blurOnEnter = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  if (!state) return null;
  return (
    <>
      <SettingRow id="peers-dispatch-depth" title={t("settings.peers_dispatch_depth")} desc={t("settings.how_deep_a_dispatch_may_chain")}>
        <span className="unit-field">
          <input type="text" inputMode="numeric" aria-label={t("settings.peers_dispatch_depth")}
            data-action-keydown="peers.dispatch-depth" data-action-change="peers.dispatch-depth"
            value={depth} disabled={busy}
            onChange={(e) => setDepth(e.target.value.replace(/\D/g, ""))}
            onBlur={() => commit(depth, "max_dispatch_depth")}
            onKeyDown={blurOnEnter} />
          <i>{t("settings.levels")}</i>
        </span>
      </SettingRow>
      <SettingRow id="peers-dispatched-sessions" title={t("settings.peers_dispatched_sessions")} desc={t("settings.how_many_sessions_one_turn")}>
        <span className="unit-field">
          <input type="text" inputMode="numeric" aria-label={t("settings.peers_dispatched_sessions")}
            data-action-keydown="peers.dispatched-sessions" data-action-change="peers.dispatched-sessions"
            value={sessions} disabled={busy}
            onChange={(e) => setSessions(e.target.value.replace(/\D/g, ""))}
            onBlur={() => commit(sessions, "max_dispatched_sessions")}
            onKeyDown={blurOnEnter} />
          <i>{t("settings.sessions")}</i>
        </span>
      </SettingRow>
      {error && <div className="why">{error}</div>}
    </>
  );
}
