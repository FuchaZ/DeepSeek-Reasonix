import { useLayoutEffect, useRef, type RefObject } from "react";

/** Makes a portalled menu usable from the keyboard: rows take focus when it
 *  opens and the trigger takes it back when it closes. A portal leaves the tab
 *  order at the document's end, so without this the arrow-key handler never
 *  receives a key. The showing row is where focus starts when the list names
 *  one, so opening it says which tab you are on rather than which is first. */
export function useMenuFocus(open: boolean, menu: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  const was = useRef(false);
  useLayoutEffect(() => {
    if (open && !was.current) {
      const rows = menu.current ? [...menu.current.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
      const showing = rows.find((row) => row.getAttribute("aria-current") !== null);
      (showing ?? rows[0])?.focus();
    } else if (!open && was.current) {
      // The list unmounted under the focus, which drops it on the body. Give it
      // back to the button rather than to the top of the document.
      const at = document.activeElement;
      if (!at || at === document.body) trigger.current?.focus();
    }
    was.current = open;
  }, [open, menu, trigger]);
}

/** Arrow keys walk the rows, Home and End take the ends, and Tab leaves the
 *  list — a menu is a stop on the way, not a place focus can be trapped in.
 *  Escape is the layer's own business (`useDismiss`), so it is not handled
 *  here. One handler for both menus, so they cannot drift apart. */
export function menuKeys(onClose: () => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "Tab") {
      // Let the press through to the page, but close first: a list left open
      // behind the next stop is a list with no visible owner.
      onClose();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    if (rows.length === 0) return;
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "Home" ? 0
      : e.key === "End" ? rows.length - 1
      : (at + (e.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length;
    rows[next]?.focus();
  };
}
