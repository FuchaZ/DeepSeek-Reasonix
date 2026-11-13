import { FEEDBACK_RETIRED } from "../feedbackchannel";
import { t } from "../i18n";
import { FeedbackBadge } from "./feedbackentry";
import type { ApprovalMode } from "../port/port";
import { barIcon, NavBarMenu, NavMorePanel, useNavBarMenu } from "./NavMore";
import { readingOf, targetOf, useBarEntries, type BarEntry } from "./navdest";
import { StudioIcon } from "./StudioIcon";
import { UpdateDot } from "./UpdateDot";

// Every entry goes somewhere that exists. A rail of icons that open nothing is
// the cheapest thing to draw and the most expensive thing to keep.

interface Props {
  at: string | null;
  onGo: (sec?: string) => void;
  onFiles: () => void;
  /** The same readings the sidebar's destination list prints, so the two never disagree. */
  wallet: string;
  approval?: ApprovalMode;
  online: number;
  hideAmounts: boolean;
  /** How many scheduled runs exist, printed beside 定时运行. */
  schedules?: number;
  /** Opens the arrangement page: order, and which entries exist at all. */
  onFeedback: () => void;
  /** A new session in the window's folder, the same action as the sidebar's. */
  onNew: () => void;
  /** The command palette, the same action as the sidebar's search row. */
  onSearch: () => void;
  feedbackUnread: number;
  /** False keeps the column mounted but out of the way and out of reach. */
  shown: boolean;
}

export function Nav({ at, onGo, onFiles, onFeedback, onNew, onSearch, feedbackUnread, shown, wallet, approval, online, hideAmounts, schedules = 0 }: Props) {
  const entries = useBarEntries();
  // What the sidebar prints beside each name. An icon column has no room for the
  // name, so the reading becomes the tooltip instead of a label.
  const run = (entry: BarEntry) => {
    if (entry.key === "new") return onNew();
    if (entry.key === "search") return onSearch();
    const target = targetOf(entry.key, entry.section ?? "");
    return target.files ? onFiles() : onGo(target.section || undefined);
  };
  const note = (entry: BarEntry) => readingOf(entry.key, { wallet, approval, online, hideAmounts, schedules });
  // A right press on the bar itself opens 自定义导航栏. No row of its own: the
  // bar is where the order and the hidden rows are seen, so it is where they
  // are arranged.
  const menu = useNavBarMenu();
  return (
    <nav className="nav" aria-label={t("settings.main_navigation")} aria-hidden={shown ? undefined : true} inert={!shown}>
      <div className="navgrp" onContextMenu={menu.openAt}>
        {/* One list for the whole bar: an order set in 自定义导航栏 is the order
            drawn here — the two commands included. */}
        {entries.map((entry) => {
          const reading = note(entry);
          const label = reading ? `${t(entry.label)} · ${reading}` : t(entry.label);
          return (
            <button
              key={entry.key}
              className="navbtn"
              data-action={entry.action}
              aria-label={label}
              aria-current={entry.section && targetOf(entry.key, entry.section).section === at ? "page" : undefined}
              onClick={() => run(entry)}
            >
              {barIcon(entry)}
              <span className="navhint" role="tooltip">{label}</span>
            </button>
          );
        })}
      </div>
      <div className="navgrp foot">
        {!FEEDBACK_RETIRED && (
          <button className="navbtn" data-action="feedback.open" onClick={onFeedback}>
            <StudioIcon name="feedback" aria-hidden="true" />
            <span className="navhint" role="tooltip">{t("common.send_feedback")}</span>
            <FeedbackBadge unread={feedbackUnread} />
          </button>
        )}
        {/* Settings only. The arrangement used to live here and the account
            beside it; 更多 arranges the bar now, and the account is reached
            from settings. */}
        <button className="navbtn" data-action="chrome.settings" aria-label={t("common.settings")} onClick={() => onGo()}>
          <StudioIcon name="settings" aria-hidden="true" />
          <UpdateDot />
          <span className="navhint" role="tooltip">{t("common.settings")}</span>
        </button>
      </div>
      {menu.at && <NavBarMenu at={menu.at} onPick={menu.customize} onClose={menu.closeMenu} />}
      {menu.open && <NavMorePanel onClose={menu.close} onRun={run} />}
    </nav>
  );
}
