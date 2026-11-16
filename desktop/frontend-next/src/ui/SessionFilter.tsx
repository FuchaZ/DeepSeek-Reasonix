import { useSyncExternalStore } from "react";
import { t } from "../i18n";
import { Picker, type MenuItem } from "./Menu";
import type { SessionScope } from "./sessionScope";
import { onRailTimeGroupsChange, railTimeGroups, setRailTimeGroups } from "../state/railTimeGroups";
import { StudioIcon } from "./StudioIcon";

export interface ScopeCounts { all: number; live: number; waiting: number; unread: number; pinned: number }

// 待处理 here is the filter's own word; the cards keep 等你处理 for a step that
// is waiting on an answer.
const NAME: Record<string, string> = { all: "common.all", live: "plan.step.now", waiting: "session.scope_waiting", unread: "common.unread", pinned: "session.pinned_2", archived: "common.archived" };

type ScopeProps = { scope: SessionScope; counts: ScopeCounts; onScope: (next: SessionScope) => void };

/** The two controls as one block, for a header that draws them side by side. */
export function SessionFilter({ scope, counts, onScope }: ScopeProps) {
  return (
    <div className="session-filter">
      <ScopeClock />
      <ScopePicker scope={scope} counts={counts} onScope={onScope} />
    </div>
  );
}

/** The clock alone: it flips the time-section reading, where each run gathers
 *  its rows under the month of their latest activity — the projects' rows
 *  among themselves, the tasks' among themselves. A toggle, not a third
 *  state: a sidebar either reads as the sections months make or as the order
 *  the kernel keeps. */
export function ScopeClock() {
  const timeGroups = useSyncExternalStore(onRailTimeGroupsChange, railTimeGroups, railTimeGroups);
  return (
    <button type="button" className="session-filter-sort" data-action="session.sort"
      aria-pressed={timeGroups}
      title={t("session.sort_by_recent")} aria-label={t("session.sort_by_recent")}
      onClick={() => setRailTimeGroups(!timeGroups)}>
      <StudioIcon name="clock" />
    </button>
  );
}

/** 全部's menu alone: which conversations are listed. */
export function ScopePicker({ scope, counts, onScope }: ScopeProps) {
  const scopes = ["all", "live", "waiting", "unread", "pinned", "archived"] as const;
  // The menu's right edge is numbers only — every row counts something.
  const items: MenuItem[] = scopes.map((value) => ({
    value,
    label: t(NAME[value]!),
    right: value === "archived" ? undefined : String(counts[value]),
    divide: value === "archived",
  }));
  return (
    <Picker
      className="session-filter-trigger"
      data-action="session.filter"
      place="top"
      align="start"
      current={scope}
      items={items}
      menuClassName="session-filter-menu"
      ariaLabel={t("session.session_scope")}
      label={<><span>{t(NAME[scope]!)}</span><StudioIcon name="down" /></>}
      onPick={(value) => onScope(value as SessionScope)}
    />
  );
}
