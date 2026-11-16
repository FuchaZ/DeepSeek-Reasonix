import { useCallback, useState } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { AgentPort, PeersSettings, PeersSettingsEdit } from "../port/port";
import type { PeersSettingsStore } from "./usePeersSettings";
import { Switch } from "./Switch";

/** The switches behind session messages, which used to be hand-written config.
 *  Saved values only reach the model at the next turn boundary — the tool table
 *  changes with them — so a saved edit says exactly that until the kernel does. */
export function PeerSettings({ port, settings, onSaved }: { port: AgentPort; settings: PeersSettingsStore; onSaved?: (next: PeersSettings) => void }) {
  const { state, publish } = settings;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = useCallback(async (edit: PeersSettingsEdit) => {
    setBusy(true);
    setError("");
    try {
      const next = await port.savePeersSettings(edit);
      publish(next);
      onSaved?.(next);
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  }, [port, publish, onSaved]);

  const shownError = error || settings.loadError;
  if (!state) return shownError ? <div className="why" role="alert">{shownError}</div> : null;
  const off = busy || !state.available;

  return (
    <div className="box">
      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.turn_on_session_messages")}</span>
          <span className="ds">{t("remote.sessions_on_this_machine_send")}</span>
        </span>
        <Switch data-action="peers.enable" on={state.enabled} busy={off} label={t("remote.turn_on_session_messages")} onClick={() => void save({ enabled: !state.enabled })} />
      </div>
      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.let_the_model_hand_a")}</span>
          <span className="ds">{state.enabled ? t("remote.gives_the_model_a_tool") : t("remote.turn_on_session_messages_first_2")}</span>
        </span>
        <Switch data-action="peers.dispatch" on={state.dispatch} busy={off || !state.enabled} label={t("remote.let_the_model_hand_a")} onClick={() => void save({ dispatch: !state.dispatch })} />
      </div>
      <div className="lrow" id="set-peers-cross-project" data-setting="peers-cross-project">
        <span className="tx">
          <span className="lb">{t("remote.cross_project")}</span>
          <span className="ds">{t("remote.cross_project_ds")}</span>
        </span>
        <div className="seg" role="radiogroup" aria-label={t("remote.cross_project")}>
          {/* The three answers are spelled out here rather than built from the
              value: a key assembled at run time is one no scan can find, so a
              missing string would only show up as its own key name on screen. */}
          {([
            ["always", t("remote.cross_project_always"), t("remote.cross_project_always_ds")],
            ["paired", t("remote.cross_project_paired"), t("remote.cross_project_paired_ds")],
            ["never", t("remote.cross_project_never"), t("remote.cross_project_never_ds")],
          ] as const).map(([k, label, hint]) => (
            <button key={k} role="radio" data-action="peers.cross-project" data-value={k} disabled={off || !state.enabled || !state.dispatch}
              aria-checked={state.cross_project === k} title={hint}
              onClick={() => void save({ cross_project: k })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.what_another_session_may_send")}</span>
          <span className="ds">{t("remote.what_another_session_may_send_ds")}</span>
        </span>
        <div className="seg" role="radiogroup" aria-label={t("remote.what_another_session_may_send")}>
          {/* The three answers are spelled out here rather than built from the
              value: a key assembled at run time is one no scan can find, so a
              missing string would only show up as its own key name on screen. */}
          {([
            ["ask", t("remote.incoming_ask"), t("remote.incoming_ask_ds")],
            ["dispatch", t("remote.incoming_dispatch"), t("remote.incoming_dispatch_ds")],
            ["always", t("remote.incoming_always"), t("remote.incoming_always_ds")],
          ] as const).map(([k, label, hint]) => (
            <button key={k} role="radio" data-action="peers.incoming" data-value={k} disabled={off || !state.enabled}
              aria-checked={state.incoming === k} title={hint}
              onClick={() => void save({ incoming: k })}>{label}</button>
          ))}
        </div>
      </div>
      <div className="lrow">
        <span className="tx">
          <span className="lb">{t("remote.open_nested_folders_without_asking")}</span>
          <span className="ds">{t("remote.open_nested_folders_without_asking_ds")}</span>
        </span>
        <Switch data-action="peers.open-nested" on={state.open_nested} busy={off || !state.enabled || !state.dispatch} label={t("remote.open_nested_folders_without_asking")} onClick={() => void save({ open_nested: !state.open_nested })} />
      </div>
      {!state.available && <div className="peernote" role="status">{t("remote.not_supported_in_this_session")}</div>}
      {state.pending && <div className="peernote" role="status">{t("remote.saved_takes_effect_from_the")}</div>}
      <div className="peernote">{t("remote.these_switches_are_kept_in")}<code>{state.path}</code></div>
      {error && <div className="why" role="alert">{error}</div>}
    </div>
  );
}
