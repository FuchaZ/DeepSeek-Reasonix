import { t } from "../i18n";
import type { AgentPort } from "../port/port";
import { HeldPeerMessage } from "./HeldPeerMessage";
import { PeerSettings } from "./PeerSettings";
import { usePeers } from "./usePeers";
import type { PeersSettingsStore } from "./usePeersSettings";

const POLL_MS = 2000;

/** The switches behind session messages, and the messages waiting for an answer.
 *  Sending is the model's job — the dispatch tool and a session's reply — so
 *  there is no box here to type one by hand. */
export function PeerMessages({ port, settings }: { port: AgentPort; settings: PeersSettingsStore }) {
  const { state, failed, refresh } = usePeers(port, POLL_MS);

  const switches = <PeerSettings port={port} settings={settings} onSaved={() => void refresh()} />;
  if (failed && !state.enabled) return <>{switches}<div className="empty">{t("remote.could_not_read_the_state")}</div></>;
  if (!state.enabled) return switches;
  if (state.held.length === 0) return switches;
  return (
    <>
      {switches}
      <div className="box">
        {state.held.map((h) => (
          <HeldPeerMessage key={h.id} port={port} held={h} onDone={() => void refresh()} />
        ))}
      </div>
    </>
  );
}
