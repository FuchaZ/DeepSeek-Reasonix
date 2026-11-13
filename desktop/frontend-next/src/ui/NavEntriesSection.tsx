import { StudioIcon } from "./StudioIcon";
import { useSyncExternalStore } from "react";
import { t } from "../i18n";
import { navLayout, onNavLayoutChange, ordered, resetNavLayout, setNavLayout } from "../state/navEntries";
import { Group } from "./Group";
import { BAR } from "./navdest";
import { Switch } from "./Switch";

const NAMES = new Map(BAR.map((entry) => [entry.key, entry.label]));
const ALL = BAR.map((entry) => entry.key);
/** The rows this page edits: every row but the one that cannot be switched
 *  off. 更多 arranges the same list, and the two must agree. */
const PLACES = new Set(BAR.filter((entry) => !entry.fixed).map((entry) => entry.key));

export function NavEntriesSection() {
  const layout = useSyncExternalStore(onNavLayoutChange, navLayout, navLayout);
  // The whole bar, not just the places: writing back only the places would drop
  // the two commands to the end of the order on the first move.
  const full = ordered(ALL, layout);
  const list = full.filter((key) => PLACES.has(key));
  const hidden = new Set(layout.hidden);
  const toggle = (key: string) => setNavLayout({ order: full, hidden: hidden.has(key) ? layout.hidden.filter((k) => k !== key) : [...layout.hidden, key] });
  const move = (key: string, by: -1 | 1) => {
    const at = full.indexOf(key);
    // The next row this page shows, skipping the commands and anything fixed.
    let to = at + by;
    while (to >= 0 && to < full.length && !PLACES.has(full[to]!)) to += by;
    if (to < 0 || to >= full.length) return;
    const next = [...full];
    [next[at], next[to]] = [next[to]!, next[at]!];
    setNavLayout({ order: next, hidden: layout.hidden });
  };
  const changed = layout.order.length > 0 || layout.hidden.length > 0;
  return (
    <Group id="naventries" title={t("settings.navigation_entries")} hint={t("settings.which_entries_the_left_rail_shows")}>
      {list.map((key, i) => (
        <div className="lrow" key={key}>
          <span className="tx">
            <span className="lb">{t(NAMES.get(key)!)}</span>
          </span>
          <button className="btn sm" data-action="appearance.nav-entry-move" data-value={`${key}:up`} disabled={i === 0} aria-label={t("settings.move_up_name", { name: t(NAMES.get(key)!) })} onClick={() => move(key, -1)}><StudioIcon name="arrow" /></button>
          <button className="btn sm" data-action="appearance.nav-entry-move" data-value={`${key}:down`} disabled={i === list.length - 1} aria-label={t("settings.move_down_name", { name: t(NAMES.get(key)!) })} onClick={() => move(key, 1)}><StudioIcon name="arrowDown" /></button>
          <Switch data-action="appearance.nav-entry-visible" data-value={key} on={!hidden.has(key)} label={t("settings.show_name", { name: t(NAMES.get(key)!) })} onClick={() => toggle(key)} />
        </div>
      ))}
      <button className="btn sm" data-action="appearance.nav-entries-reset" disabled={!changed} onClick={resetNavLayout}>{t("settings.reset_arrangement")}</button>
    </Group>
  );
}
