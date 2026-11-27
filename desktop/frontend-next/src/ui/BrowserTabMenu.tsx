import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import { keyOf, type Surface } from "./workbench_tabs";
import { useBack } from "./back";
import { listenAction } from "./listen";
import { pinToViewport } from "./place";

interface Props {
  menu: { surface: Surface; x: number; y: number; anchor: HTMLElement };
  // How many tabs each choice closes, said beside it; label names the tab the menu is for.
  others: number; left: number; right: number; all: number; label: string; onDismiss: () => void; onClose: (mode: "one" | "others" | "left" | "right" | "all") => void;
}

export function BrowserTabMenu({ menu, others, left, right, all, label, onDismiss, onClose }: Props) {
  const box = useRef<HTMLDivElement>(null);
  useBack(true, onDismiss);
  useEffect(() => {
    const dismiss = (event: Event) => { if (!box.current?.contains(event.target as Node)) onDismiss(); };
    const blur = () => onDismiss();
    const off = listenAction(document, "pointerdown", { action: "layer.dismiss", listener: dismiss });
    window.addEventListener("blur", blur);
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      off();
      window.removeEventListener("blur", blur);
      // Another layer can open in the same commit this menu closes — the
      // question about unsaved text does, and its Save button focuses itself.
      // This cleanup runs after that, so handing focus back unconditionally
      // would take it straight out of the question. It goes back to the tab
      // only when the menu is still where the person is.
      const at = document.activeElement;
      const held = !at || at === document.body || at === menu.anchor || !!box.current?.contains(at);
      if (held && menu.anchor.isConnected) menu.anchor.focus();
    };
  }, [menu, onDismiss]);
  return createPortal(
    <div className="tabmenu" data-action-keydown="layer.dismiss" role="menu" aria-label={t("workbench.browser_tabs")} ref={(el) => { box.current = el; if (el) pinToViewport(el, menu.x, menu.y); }} onKeyDown={(e) => {
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); e.stopPropagation(); onDismiss(); }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }}>
      <div className="tabmenu-head"><span>{t("workbench.browser_tab_named", { name: label })}</span></div>
      <button role="menuitem" data-action="workbench.close" data-target={keyOf(menu.surface)} onClick={() => onClose("one")}><span>{t("workbench.close_current_browser_tab")}</span></button>
      <button role="menuitem" data-action="workbench.browser-close" data-target={keyOf(menu.surface)} data-value="others" aria-label={t("workbench.close_other_browser_tabs")} disabled={!others} onClick={() => onClose("others")}>
        <span>{t("workbench.close_other_browser_tabs")}</span>{others > 0 && <kbd>{others}</kbd>}
      </button>
      <button role="menuitem" data-action="workbench.browser-close" data-target={keyOf(menu.surface)} data-value="left" aria-label={t("workbench.close_browser_tabs_to_the_left")} disabled={!left} onClick={() => onClose("left")}>
        <span>{t("workbench.close_browser_tabs_to_the_left")}</span>{left > 0 && <kbd>{left}</kbd>}
      </button>
      <button role="menuitem" data-action="workbench.browser-close" data-target={keyOf(menu.surface)} data-value="right" aria-label={t("workbench.close_browser_tabs_to_the")} disabled={!right} onClick={() => onClose("right")}>
        <span>{t("workbench.close_browser_tabs_to_the")}</span>{right > 0 && <kbd>{right}</kbd>}
      </button>
      <button role="menuitem" data-action="workbench.browser-close" data-target={keyOf(menu.surface)} data-value="all" aria-label={t("workbench.close_all_browser_tabs")} disabled={!all} onClick={() => onClose("all")}>
        <span>{t("workbench.close_all_browser_tabs")}</span>{all > 0 && <kbd>{all}</kbd>}
      </button>
    </div>, document.body,
  );
}
