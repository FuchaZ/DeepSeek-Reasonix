import { t } from "../i18n";
import type { AgentPort } from "../port/port";
import { AuthorLine } from "./AuthorLine";
import { Group } from "./Group";
import { Logs } from "./Logs";
import { SectionCard } from "./SectionCard";
import { TraceExport } from "./TraceExport";
import { Versions } from "./Versions";

// Signing in used to have a card here. Nothing else in the app needs it now, so
// the page is what its name says: the version, the diagnostics, and who made it.
export function AccountSettings({ port, homePort }: { port: AgentPort; homePort: AgentPort }) {
  return (
    <>
      <SectionCard title={t("settings.version_and_diagnostics")}>
        <Group id="versions" title={t("common.version")} hint={t("settings.versions_hint")}>
          <Versions port={homePort} />
        </Group>
        <Group id="logs" title={t("about.logs_and_abnormal_exit_records")} hint={t("settings.logs_hint")}>
          <Logs port={homePort} />
        </Group>
        <TraceExport port={port} />
      </SectionCard>
      <SectionCard title={t("settings.about")}>
        <AuthorLine port={homePort} />
      </SectionCard>
    </>
  );
}
