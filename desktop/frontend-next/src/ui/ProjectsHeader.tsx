import { useContext } from "react";
import { t } from "../i18n";
import type { Adder } from "./addws";
import { StudioIcon } from "./StudioIcon";
import { RailFilterContext } from "./railfilter";

/** The row above the tree: which view is on, the fold-all control, the session
 *  filter, and the way into a new project. Ordering by recency lives in the
 *  filter menu, beside the scopes it reorders, rather than as a control of its
 *  own up here. */
export function ProjectsHeader({ adder, onToggleAll, allFolded, canFold, searching, onSelect, selecting, canSelect }: {
  adder: Adder;
  onToggleAll?: () => void;
  allFolded?: boolean;
  canFold?: boolean;
  searching?: boolean;
  /** Start picking conversations. The control sits beside fold-all because both
   *  act on the whole list, and a project row grows a checkbox once it is on. */
  onSelect?: () => void;
  selecting?: boolean;
  canSelect?: boolean;
}) {
  const filter = useContext(RailFilterContext);
  return (
    <div className="projects-header">
      <div className="projects-tabs">
        <div className="vtabs" role="group" aria-label={t("session.session_view")}>
          <button type="button" className="vtab" data-action="session.view" data-value="projects" aria-pressed="true">{t("common.project")}</button>
        </div>
        <span className="projects-spacer" />
        {onToggleAll && (
          <button className="projects-add projects-fold" data-action="workspace.fold-all" disabled={!canFold || searching} aria-expanded={!allFolded}
            title={t(searching ? "session.projects_expand_automatically_while_searching" : allFolded ? "session.expand_all_projects" : "session.collapse_all_projects")} aria-label={t(allFolded ? "session.expand_all_projects" : "session.collapse_all_projects")} onClick={onToggleAll}>
            <StudioIcon name={allFolded ? "unfoldAll" : "foldAll"} />
          </button>
        )}
        {filter}
        {onSelect && (
          <button className="projects-add projects-select" data-action="session.selection" data-value="start"
            data-on={selecting ? "" : undefined} aria-pressed={selecting}
            disabled={!selecting && !canSelect}
            title={t("session.select_local_sessions")} aria-label={t("session.select_local_sessions")} onClick={onSelect}>
            <StudioIcon name="check" />
          </button>
        )}
        <button className="projects-add" data-busy={adder.busy ? "" : undefined} disabled={adder.busy}
          title={t("session.open_project")} aria-label={t("session.open_project")} data-action="workspace.add" onClick={() => adder.add()}>
          <StudioIcon name="plus" />
        </button>
      </div>
    </div>
  );
}
