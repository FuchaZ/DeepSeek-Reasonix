import { t } from "../i18n";
import type { ApprovalMode } from "../port/port";
import { barIcon, NavBarMenu, NavMorePanel, useNavBarMenu } from "./NavMore";
import { readingOf, targetOf, useBarEntries, type BarEntry } from "./navdest";
import { useHidesAmounts } from "./wallet";

/** The nav bar's rows, spelled out down the column. Collapsing the column moves
 *  the same rows onto a rail of icons; open, they belong here, in the same order
 *  and under the same names — one list, drawn twice, so the two cannot disagree
 *  or offer a row twice. Which rows exist and where they sit is 更多's business. */
export function SidebarDestinations({ wallet, approval, online, schedules, onGo, onFiles, onNew, onSearch }: {
  wallet: string; approval?: ApprovalMode; online: number; schedules?: number;
  onGo: (section?: string) => void; onFiles: () => void; onNew: () => void; onSearch: () => void;
}) {
  const entries = useBarEntries();
  const hideAmounts = useHidesAmounts();
  const run = (entry: BarEntry) => {
    if (entry.key === "new") return onNew();
    if (entry.key === "search") return onSearch();
    const target = targetOf(entry.key, entry.section ?? "");
    return target.files ? onFiles() : onGo(target.section || undefined);
  };
  const shortcut = (key: string): string | undefined => (key === "new" ? "Alt N" : key === "search" ? "Ctrl K" : undefined);
  // The same right press offers the same menu here: one arrangement, drawn twice.
  const menu = useNavBarMenu();
  return (
    <div className="studio-navlist" role="group" aria-label={t("settings.main_navigation")} onContextMenu={menu.openAt}>
      {entries.map((entry) => {
        const reading = readingOf(entry.key, { wallet, approval, online, hideAmounts, schedules: schedules ?? 0 });
        const label = reading ? `${t(entry.label)} · ${reading}` : t(entry.label);
        const target = targetOf(entry.key, entry.section ?? "");
        // The two commands keep the rows they have always had, so their look and
        // the shortcuts they advertise do not depend on this list being built.
        // A row that acts must spell its id inside the attribute: the census
        // reads the attribute, so an id that arrives only through the
        // arrangement table leaves the registry entry orphaned.
        const className = entry.key === "new" ? "studio-new-task" : entry.key === "search" ? "studio-search" : "studio-navrow";
        return (
          <button
            key={entry.key}
            type="button"
            className={className}
            data-action={target.files ? "files.open" : entry.action === "workspace.search" ? "workspace.search" : entry.action ?? (entry.section ? "settings.section" : undefined)}
            data-value={target.files ? undefined : target.section}
            title={shortcut(entry.key)}
            aria-label={label}
            onClick={() => run(entry)}
          >
            <span aria-hidden="true">{barIcon(entry)}</span>
            <b className="studio-label">{t(entry.label)}</b>
            {reading && <small>{reading}</small>}
          </button>
        );
      })}
      {menu.at && <NavBarMenu at={menu.at} onPick={menu.customize} onClose={menu.closeMenu} />}
      {menu.open && <NavMorePanel onClose={menu.close} onRun={run} />}
    </div>
  );
}
