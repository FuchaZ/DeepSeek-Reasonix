import { t } from "../i18n";
import type { HubPort } from "../port/hub";
import type { AgentPort } from "../port/port";
import { Group } from "./Group";
import { PeerDispatch } from "./PeerDispatch";
import { PeerMessages } from "./PeerMessages";
import { PeerProjects } from "./PeerProjects";
import { usePeersSettings } from "./usePeersSettings";

// Messages between the user's own sessions: whether they are on, which projects
// take one without a card, and a task the person hands over themselves.
export function PeersSection({ port, hub }: { port: AgentPort; hub: Pick<HubPort, "tree"> }) {
  const settings = usePeersSettings(port);
  return (
    <Group id="peers"
      title={t("remote.messages_between_sessions_experimental")}
      hint={t("settings.sessions_send_each_other")}
    >
      <PeerMessages port={port} settings={settings} />
      <Group id="peer-projects"
        title={t("remote.projects_allowed_through")}
        hint={t("remote.sessions_in_these_projects_take")}
      >
        <PeerProjects port={port} hub={hub} settings={settings} />
      </Group>
      <Group id="peer-dispatch"
        title={t("remote.hand_over_a_task")}
        hint={t("remote.a_task_you_hand_over_yourself")}
      >
        <PeerDispatch port={port} hub={hub} settings={settings} />
      </Group>
    </Group>
  );
}
