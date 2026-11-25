import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { StudioIcon } from "./StudioIcon";
import { TooltipButton } from "./TooltipButton";
import { useDismiss } from "./dismiss";
import { menuKeys, useMenuFocus } from "./menufocus";
import { useFollow, pinToViewport } from "./place";

/** Every tab the workbench has open, as one list to jump from. The strip
 *  scrolls and its tail can be hidden; this reaches a tab without scrolling or
 *  closing anything, and is drawn whether or not anything is hidden. The list
 *  is portalled to the body and fixed: docked, the button sits on the window
 *  bar, where a list inside it would be clipped and take drag presses. */
export function WorkbenchTabPicker({ tabs, active, onPick, shown = true }: {
  tabs: { key: string; label: string }[];
  active: string;
  onPick: (key: string) => void;
  shown?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shut = useCallback(() => setOpen(false), []);
  // The menu is portalled, so hiding the workbench does not unmount it.
  useEffect(() => { if (!shown) setOpen(false); }, [shown]);
  // The menu is not a DOM descendant of its button, so the button is named as a
  // second inside box; without it a press on the list would read as a press
  // away and close the list being pressed.
  useDismiss(open, menu, shut, trigger);
  // A portal takes the list out of the button's subtree, so focus has to be
  // handed to it on open and handed back on close: see menufocus.ts.
  useMenuFocus(open, menu, trigger);
  const onKeys = useCallback(menuKeys(shut), [shut]);
  // Left-aligned with the button, since the button starts the strip: the list
  // then opens inwards rather than off the window's left edge.
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    const el = menu.current;
    if (!anchor || !el) return;
    pinToViewport(el, anchor.left, anchor.bottom + 4);
  }, []);
  useFollow(open, place, `${tabs.length}:${active}`);
  if (tabs.length === 0) return null;
  return (
    <>
      <TooltipButton
        className="workbench-picker"
        data-action="workbench.tab-picker"
        ref={trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("workbench.switch_tab")}
        title={t("workbench.switch_tab")}
        onClick={() => setOpen((v) => !v)}
      >
        <StudioIcon name="list" />
        {/* How many tabs the strip holds, said here rather than at the end of
            the strip: this is the control that reaches all of them, including
            the ones a narrow strip has scrolled out of sight. */}
        <span className="workbench-picker-count">{tabs.length}</span>
      </TooltipButton>
      {open && createPortal(
        <div className="workbench-picker-menu" role="menu" aria-label={t("workbench.open_tabs")} ref={menu}
          data-action-keydown="workbench.tab-picker"
          onKeyDown={onKeys}>
          {tabs.map((tab) => (
            <button key={tab.key} type="button" role="menuitem" data-action="workbench.tab" data-target={tab.key}
              aria-current={tab.key === active ? "true" : undefined}
              title={tab.label}
              onClick={() => { setOpen(false); onPick(tab.key); }}>
              <StudioIcon name="file" />
              <span>{tab.label}</span>
              {/* The tick says which tab is showing. Only the current row draws
                  it (CSS), because a list of six tabs all named "about:blank"
                  has nothing else to tell them apart. */}
              <StudioIcon name="check" className="workbench-picker-mark" />
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
