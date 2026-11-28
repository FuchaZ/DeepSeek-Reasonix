import { useContext } from "react";
import { t } from "../i18n";
import type { Adder } from "./addws";
import { RailFilterContext } from "./railfilter";
import { StudioIcon } from "./StudioIcon";
import { WsMark } from "./WsMark";

/** The row above the tree: the view's name, the session filter and the way
 *  into picking conversations. The name folds both runs at once — every folder
 *  that can fold, and every empty run's note — with the same arrow the group
 *  labels answer to; folding a single group lives on its own label. The check
 *  starts a picking session, because it acts on the whole list the way the
 *  fold does. */
export function ProjectsHeader({ adder, bothFolded, searching, onToggleBoth, onToggleProjects, projectsFolded, canFoldProjects, onSelect, selecting, canSelect }: {
  adder: Adder;
  bothFolded?: boolean;
  searching?: boolean;
  onToggleBoth?: () => void;
  /** Fold every project folder's sessions, not the runs themselves. */
  onToggleProjects?: () => void;
  projectsFolded?: boolean;
  canFoldProjects?: boolean;
  /** Start picking conversations: the same mode a session's own menu opens,
   *  offered here because it acts on the list rather than on one row. */
  onSelect?: () => void;
  selecting?: boolean;
  canSelect?: boolean;
}) {
  const rail = useContext(RailFilterContext);
  const said = t(bothFolded ? "session.expand_all_groups" : "session.collapse_all_groups");
  const foldersSaid = t(projectsFolded ? "session.expand_all_project_sessions" : "session.collapse_all_project_sessions");
  return (
    <div className="projects-header">
      <div className="projects-tabs">
        <button type="button" className="vtab" aria-current="true"
          data-action="workspace.fold-all" data-value="both"
          disabled={!onToggleBoth || searching}
          aria-expanded={onToggleBoth ? !bothFolded : undefined}
          title={said} aria-label={said}
          onClick={onToggleBoth}>
          {t("session.task_list")}
          <WsMark open={onToggleBoth ? !bothFolded : undefined} />
        </button>
        {onToggleProjects && (
          <button type="button" className="projects-toggle" data-action="workspace.fold-all" data-value="folders"
            disabled={!canFoldProjects || searching || bothFolded}
            aria-expanded={canFoldProjects ? !projectsFolded : undefined}
            title={foldersSaid} aria-label={foldersSaid} onClick={onToggleProjects}>
            <StudioIcon name={projectsFolded ? "unfoldAll" : "foldAll"} />
          </button>
        )}
        <span className="projects-spacer" />
        {rail?.clock}
        <button className="projects-add" data-busy={adder.busy ? "" : undefined} disabled={adder.busy}
          title={t("session.open_project")} aria-label={t("session.open_project")} data-action="workspace.add" onClick={() => adder.add()}>
          <StudioIcon name="plus" />
        </button>
        {onSelect && (
          <button className="projects-add projects-select" data-action="session.selection" data-value="start"
            data-on={selecting ? "" : undefined} aria-pressed={selecting}
            disabled={!selecting && !canSelect}
            title={t("session.select_local_sessions")} aria-label={t("session.select_local_sessions")} onClick={onSelect}>
            <StudioIcon name="check" />
          </button>
        )}
        {rail?.scope}
      </div>
    </div>
  );
}
