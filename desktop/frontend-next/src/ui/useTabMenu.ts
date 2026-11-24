import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Surface } from "./workbench_tabs";
import { keyOf } from "./workbench_tabs";

interface Deps {
  surfaces: Surface[];
  // Paths whose text is unsaved: a batch never carries one, and nothing that
  // would drop an edit is offered.
  unsaved: string[];
  closing: boolean;
  // Where focus goes back to when the menu closes and nothing else took it.
  newTab: RefObject<HTMLButtonElement | null>;
  close: (targets: Surface[]) => unknown;
  askAbout: (at: { path: string; anchor: HTMLElement }) => void;
}

/** The strip's own right-press menu: which tab it speaks for, what each bulk
 *  choice would really close, and the focus it hands back afterwards.
 *
 *  A file is a tab here — closing one from the menu is what its × does, and the
 *  strip is the only way to reach a tab the pointer is not over. A file whose
 *  text is unsaved is left out of every count, because `close` drops the
 *  targets it is given without asking: a menu may not offer a press that would
 *  throw an edit away, and what it says it will close has to be what it closes.
 */
export function useTabMenu({ surfaces, unsaved, closing, newTab, close, askAbout }: Deps) {
  const [tabMenu, setTabMenu] = useState<{ surface: Surface; x: number; y: number; anchor: HTMLElement } | null>(null);
  const dismiss = useCallback(() => setTabMenu(null), []);
  const tabAt = tabMenu ? surfaces.findIndex((s) => keyOf(s) === keyOf(tabMenu.surface)) : -1;
  const closable = (list: Surface[]) => list.filter((s) => !(s.kind === "file" && unsaved.includes(s.path)));
  const others = tabMenu ? closable(surfaces.filter((s) => keyOf(s) !== keyOf(tabMenu.surface))) : [];
  const left = tabAt < 0 ? [] : closable(surfaces.slice(0, tabAt));
  const right = tabAt < 0 ? [] : closable(surfaces.slice(tabAt + 1));
  const all = closable(surfaces);
  const returning = useRef("");
  useEffect(() => {
    if (tabMenu && tabAt < 0) setTabMenu(null);
    if (tabMenu || closing || !returning.current) return;
    const picks = [...document.querySelectorAll<HTMLButtonElement>(".workbench-tab-pick")];
    const back = picks.find((b) => b.dataset.target === returning.current) ?? picks.find((b) => b.closest('[aria-selected="true"]'));
    returning.current = "";
    (back ?? newTab.current)?.focus();
  }, [tabMenu, tabAt, surfaces, closing, newTab]);
  const offer = (e: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, surface: Surface) => {
    if (closing || document.getSelection()?.isCollapsed === false) return;
    e.preventDefault();
    e.stopPropagation();
    const anchor = e.currentTarget.matches("button") ? e.currentTarget : e.currentTarget.querySelector<HTMLElement>(".workbench-tab-pick")!;
    const rect = anchor.getBoundingClientRect();
    const pointed = "clientX" in e && (e.clientX !== 0 || e.clientY !== 0);
    setTabMenu({ surface, x: pointed ? e.clientX : rect.left, y: pointed ? e.clientY : rect.bottom, anchor });
  };
  const takeClose = (mode: "one" | "others" | "left" | "right" | "all") => {
    if (!tabMenu) return;
    const target = tabMenu.surface;
    setTabMenu(null);
    if (mode === "one" && target.kind === "file" && unsaved.includes(target.path)) {
      // The press was on this tab, so it is not in the closable lists: ask about
      // its text the way its × does, anchored on the tab it belongs to. No
      // `returning` here — that effect would take focus straight out of the
      // question this opens.
      askAbout({ path: target.path, anchor: tabMenu.anchor });
      return;
    }
    returning.current = keyOf(target);
    void close(mode === "one" ? [target] : mode === "others" ? others : mode === "left" ? left : mode === "right" ? right : all);
  };
  return {
    menu: tabMenu, dismiss, offer, takeClose,
    counts: { others: others.length, left: left.length, right: right.length, all: all.length },
  };
}
