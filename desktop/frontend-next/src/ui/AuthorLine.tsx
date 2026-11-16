import { t } from "../i18n";
import type { AgentPort } from "../port/port";
import { COMMUNITY } from "./communityLinks";

export function AuthorLine({ port }: { port: Pick<AgentPort, "openExternal"> }) {
  const open = (url: string) => (e: { preventDefault(): void }) => {
    e.preventDefault();
    void port.openExternal(url).catch(() => {});
  };
  return (
    <>
      <div className="comm-author">
        <span className="comm-k">{t("app.maintainer")}</span>
        <a href={COMMUNITY.authorUrl} data-action="community.author" onClick={open(COMMUNITY.authorUrl)}>{COMMUNITY.author}</a>
        <a href={COMMUNITY.repoUrl} data-action="community.repo" onClick={open(COMMUNITY.repoUrl)}>{COMMUNITY.repoUrl}</a>
      </div>
      <div className="comm-author">
        <span className="comm-k">{t("app.original_author")}</span>
        <span className="comm-name">{COMMUNITY.upstreamAuthor}</span>
      </div>
    </>
  );
}
