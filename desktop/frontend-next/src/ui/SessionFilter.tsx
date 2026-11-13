import { useSyncExternalStore } from "react";
import { t } from "../i18n";
import { Picker, type MenuItem } from "./Menu";
import type { SessionScope } from "./sessionScope";
import { nextRecencySort, onRecencySortChange, recencySort, setRecencySort } from "../state/recencySort";
import { StudioIcon } from "./StudioIcon";

export interface ScopeCounts { all: number; live: number; waiting: number; unread: number; pinned: number }

// 待处理 here is the filter's own word; the cards keep 等你处理 for a step that
// is waiting on an answer.
const NAME: Record<string, string> = { all: "common.all", live: "plan.step.now", waiting: "session.scope_waiting", unread: "common.unread", pinned: "session.pinned_2", archived: "common.archived" };

/** The filter menu: which conversations are listed, and — right under 全部 —
 *  which way round they are ordered. Ordering lives here because it acts on the
 *  same list the scopes narrow, and a row of its own up on the toolbar made it
 *  look like a second view.
 *
 *  最近 is one word with an arrow, not a switch: a switch can only say on or
 *  off, and the same order read the other way round is a thing people ask for.
 *  Picking it cycles newest → oldest → unsorted. */
export function SessionFilter({ scope, counts, onScope }: { scope: SessionScope; counts: ScopeCounts; onScope: (next: SessionScope) => void }) {
  const sort = useSyncExternalStore(onRecencySortChange, recencySort, recencySort);
  const scopes = ["all", "live", "waiting", "unread", "pinned", "archived"] as const;
  // The arrow is always there so the row never looks like plain text: up is
  // newest first, down is oldest first, and ⇅ means unsorted.
  const order: MenuItem = {
    value: "recent",
    label: t("session.sort_by_recent"),
    right: sort === "newest" ? "↑" : sort === "oldest" ? "↓" : "⇅",
  };
  const items: MenuItem[] = scopes.flatMap((value) => {
    const row: MenuItem = {
      value,
      label: t(NAME[value]!),
      right: value === "archived" ? undefined : String(counts[value]),
      divide: value === "archived",
    };
    return value === "all" ? [row, order] : [row];
  });
  return (
    <div className="session-filter">
      <Picker
        className="session-filter-trigger"
        data-action="session.filter"
        place="bottom"
        align="end"
        current={scope}
        items={items}
        menuClassName="session-filter-menu"
        ariaLabel={t("session.session_scope")}
        label={<><span>{t(NAME[scope]!)}</span><StudioIcon name="down" /></>}
        stayOpen={(value) => value === "recent"}
        onPick={(value) => (value === "recent" ? setRecencySort(nextRecencySort(sort)) : onScope(value as SessionScope))}
      />
      {scope !== "all" && (
        <button type="button" className="session-filter-clear" data-action="session.filter-clear" aria-label={t("session.clear_filter")} onClick={() => onScope("all")}>
          <StudioIcon name="close" />
        </button>
      )}
    </div>
  );
}
