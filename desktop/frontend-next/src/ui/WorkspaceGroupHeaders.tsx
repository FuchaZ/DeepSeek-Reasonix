import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";
import { WsMark } from "./WsMark";

const WORDS = {
  projects: {
    expand: "session.expand_all_projects",
    collapse: "session.collapse_all_projects",
    searching: "session.projects_expand_automatically_while_searching",
  },
  tasks: {
    expand: "session.expand_all_tasks",
    collapse: "session.collapse_all_tasks",
    searching: "session.tasks_expand_automatically_while_searching",
  },
} as const;

/** The label doubles as the handle that drags its run above the other one, so
 *  the drag handlers ride on whatever shape the label takes. */
export interface GroupDragProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDragLeave?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}

/** The tree's two standing labels: folders the person chose (项目), and the
 *  folder the window itself opened in (任务). Each label carries its run's
 *  fold-all, writing the same folded set the rows' own chevrons read, so one
 *  click rests the whole group and every chevron agrees with the label. The
 *  arrow rides beside the label's words: folded it points ahead, open it
 *  points down, and a run with nothing to fold shows no arrow at all. The
 *  row's right edge is its plus: a project run adds a project to itself, the
 *  task run opens the window's own kind of conversation. */
export function WorkspaceGroupHead({ group, folded, canFold, searching, onToggle, dragProps, dropping, dragging, onAdd, adding }: {
  group: "projects" | "tasks";
  folded: boolean;
  canFold?: boolean;
  searching?: boolean;
  onToggle?: () => void;
  dragProps?: GroupDragProps;
  /** The edge the carried run will land on, as the pointer names it. */
  dropping?: "before" | "after";
  dragging?: boolean;
  onAdd?: (at: ReactMouseEvent) => void;
  adding?: boolean;
}) {
  const label = group === "projects" ? t("common.project") : t("session.tasks");
  // The row is the drag: the label and the plus both live in it, so the
  // carried state and the insertion line ride the whole row. The line follows
  // the pointer's half — above the label when the run will go over it, below
  // when it will go under — the way every other row in the tree speaks.
  const drag = {
    draggable: dragProps?.draggable,
    onDragStart: dragProps?.onDragStart,
    onDragOver: dragProps?.onDragOver,
    onDragLeave: dragProps?.onDragLeave,
    onDrop: dragProps?.onDrop,
    onDragEnd: dragProps?.onDragEnd,
    "data-drop": dropping,
    "data-dragging": dragging ? "" : undefined,
  };
  const plus = onAdd && (group === "projects" ? (
    <button type="button" className="wsadd-run" data-action="workspace.add-group"
      disabled={adding} title={t("session.add_a_new_project")}
      aria-label={t("session.add_a_new_project")}
      onClick={(ev) => { ev.stopPropagation(); onAdd(ev); }}>
      <StudioIcon name="plus" />
    </button>
  ) : (
    <button type="button" className="wsadd-run" data-action="session.new-task"
      disabled={adding} title={t("session.new_task_session")}
      aria-label={t("session.new_task_session")}
      onClick={(ev) => { ev.stopPropagation(); onAdd(ev); }}>
      <StudioIcon name="plus" />
    </button>
  ));
  if (!onToggle) {
    return <div className="wsgroupline" {...drag}><span className="wsgroup" draggable={drag.draggable}><span>{label}</span></span>{plus}</div>;
  }
  const words = WORDS[group];
  const said = t(searching ? words.searching : folded ? words.expand : words.collapse);
  return (
    <div className="wsgroupline" {...drag}>
      {/* The gesture must start on a draggable element, and the fold button is
          where the pointer lands — so the button carries the drag too. */}
      <button type="button" className="wsgroup" data-action="workspace.fold-all" data-value={group}
        draggable={drag.draggable}
        disabled={!canFold || searching} aria-expanded={canFold ? !folded : undefined}
        title={said} aria-label={said} onClick={onToggle}>
        <span>{label}</span>
        <WsMark open={canFold ? !folded : undefined} />
      </button>
      {plus}
    </div>
  );
}
