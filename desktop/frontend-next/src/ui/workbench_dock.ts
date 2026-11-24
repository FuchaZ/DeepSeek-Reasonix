import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useDockHead } from "../state/dockhead";

/** Where the docked workbench's tab strip is drawn: the chrome's slot when the
 *  dock has a column of its own, and null when the strip must stay home.
 *
 *  Stacking is decided in CSS — a container query and the scene fold both set
 *  `--dock-stacked` on the column — and read back here rather than guessed
 *  from the window width: two thresholds in two places is how the bar and the
 *  column came apart. */
export function useWorkbenchDock(frame: RefObject<HTMLElement | null>, docked: boolean): HTMLElement | null {
  const slot = useDockHead();
  const [stacked, setStacked] = useState(false);
  useLayoutEffect(() => {
    const pane = frame.current?.closest(".pane");
    const column = pane?.querySelector('[data-pane="browser"]');
    if (!pane || !column) return;
    const read = () => setStacked(getComputedStyle(column).getPropertyValue("--dock-stacked").trim() !== "");
    read();
    // Two signals, neither covering the other: the container query answers a
    // narrower pane, while the scene fold is decided from the window and leaves
    // the pane's own width unchanged.
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(read) : null;
    ro?.observe(pane);
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-fold"] });
    return () => { ro?.disconnect(); mo.disconnect(); };
  }, [frame, docked]);
  return docked && !stacked ? slot : null;
}

/** The strip changes home by unmounting, so the pressed full-width control loses
 *  focus to the body. This panel outlives the move, which is why the hand-off
 *  lives here rather than in the button: the pressed copy is gone by the time
 *  focus can be given back. Only a focus actually lost is restored. */
export function useFullToggleFocus(frame: RefObject<HTMLElement | null>, full: boolean | undefined) {
  const was = useRef(full);
  useLayoutEffect(() => {
    if (was.current === full) return;
    was.current = full;
    // Judged after the frame: at this point the pressed button is still the
    // focused node, and it only falls to the body once React detaches it.
    requestAnimationFrame(() => {
      const at = document.activeElement;
      if (at && at !== document.body && at.isConnected) return;
      frame.current?.querySelector<HTMLElement>('[data-action="browser.full"]')?.focus();
    });
  }, [frame, full]);
}
