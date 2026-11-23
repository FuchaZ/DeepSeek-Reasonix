import { useEffect, useState } from "react";
import { t } from "../i18n";
import { reason } from "../i18n/kernel";
import type { HubPort, TreeWorkspace } from "../port/hub";
import type { AgentPort } from "../port/port";
import type { PeersSettingsStore } from "./usePeersSettings";

// A task the person hands to one of their projects themselves. The card that
// gates the model's dispatch_to_project is not asked again: pressing this
// control is the answer that card would have collected.
export function PeerDispatch({ port, hub, settings }: { port: AgentPort; hub: Pick<HubPort, "tree">; settings: PeersSettingsStore }) {
  const [known, setKnown] = useState<TreeWorkspace[]>([]);
  const [project, setProject] = useState("");
  const [text, setText] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  useEffect(() => {
    let alive = true;
    hub.tree({ limit: 1 }).then(
      (tree) => { if (alive) setKnown(tree.filter((w) => w.remembered && w.root.length > 0)); },
      () => { if (alive) setKnown([]); },
    );
    return () => { alive = false; };
  }, [hub]);

  const state = settings.state;
  const target = known.some((w) => w.root === project) ? project : known[0]?.root ?? "";
  const off = busy || !state?.available || !state?.enabled || !state?.dispatch;

  const start = async () => {
    if (!target || !text.trim()) return;
    setBusy(true);
    setError("");
    setDone("");
    try {
      const got = await port.dispatchToProject(target, text.trim(), role.trim() || undefined);
      const name = known.find((w) => w.root === got.project)?.name ?? got.project;
      setDone(got.role
        ? t("remote.dispatched_to_project_as_role", { project: name, role: got.role })
        : t("remote.dispatched_to_project", { project: name }));
      setText("");
      setRole("");
    } catch (e) {
      setError(reason(e));
    } finally {
      setBusy(false);
    }
  };

  const shownError = error || settings.loadError;
  if (!state) return shownError ? <div className="why" role="alert">{shownError}</div> : null;
  if (!state.available) return <div className="peernote" role="status">{t("remote.not_supported_in_this_session")}</div>;
  if (!state.enabled) return <div className="peernote">{t("remote.turn_on_session_messages_first")}</div>;
  if (!state.dispatch) return <div className="peernote">{t("remote.turn_on_dispatch_first")}</div>;
  if (known.length === 0) return <div className="peernote">{t("remote.there_is_no_project_to")}</div>;

  return (
    <div className="peerform">
      <label className="peerhead" htmlFor="peer-dispatch-project">{t("remote.dispatch_project")}</label>
      <select id="peer-dispatch-project" className="peerfield" data-action-change="peers.dispatch-project"
        aria-label={t("remote.dispatch_project")} value={target} disabled={off}
        onChange={(e) => setProject(e.target.value)}>
        {known.map((w) => <option key={w.root} value={w.root}>{`${w.name} — ${w.root}`}</option>)}
      </select>
      <label className="peerhead" htmlFor="peer-dispatch-text">{t("remote.dispatch_task")}</label>
      <textarea id="peer-dispatch-text" className="peerfield" rows={3} data-action-change="peers.dispatch-text"
        aria-label={t("remote.dispatch_task")} value={text} disabled={off}
        onChange={(e) => setText(e.target.value)} />
      <label className="peerhead" htmlFor="peer-dispatch-role">{t("remote.dispatch_role_optional")}</label>
      <input id="peer-dispatch-role" className="peerfield" type="text" data-action-change="peers.dispatch-role"
        aria-label={t("remote.dispatch_role_optional")} value={role} disabled={off}
        onChange={(e) => setRole(e.target.value)} />
      <div className="acts">
        <button className="act" data-action="peers.dispatch-start" data-primary
          disabled={off || !target || !text.trim()} onClick={() => void start()}>
          {t("remote.start_dispatch")}
        </button>
      </div>
      {done && <div className="peernote" role="status">{done}</div>}
      {error && <div className="why" role="alert">{error}</div>}
    </div>
  );
}
