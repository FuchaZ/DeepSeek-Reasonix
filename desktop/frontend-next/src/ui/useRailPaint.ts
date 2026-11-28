import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/** The rail overlays the reading column, so the scroller is moved rather than
 *  resized: below the column's cap the whole scrollbox can follow by transform,
 *  and above it the column itself has to narrow, which no transform can do. */
export function useRailPaint({ rail, drawer, railW, active, panes }: {
  rail: boolean;
  drawer: boolean;
  railW: number;
  active: string;
  panes: number;
}) {
  const railSlide = useRef(false);
  const railShell = useRef({ rail, drawer, railW });
  railShell.current = { rail, drawer, railW };
  const paintRail = useCallback(() => {
    const pane = document.querySelector<HTMLElement>(".pane:not([data-off])");
    if (!pane) return;
    const { rail, drawer, railW } = railShell.current;
    const open = rail && !drawer ? railW : 0;
    // The rail overlays the whole reading canvas: the transcript's scrollbox and
    // the composer both clear it, or the composer's left half sits under the rail.
    for (const el of [
      pane.querySelector<HTMLElement>('.scroll[data-pane="flow"]'),
      pane.querySelector<HTMLElement>(".compose"),
      pane.querySelector<HTMLElement>(".composer-top"),
    ]) {
      if (!el) continue;
      el.style.setProperty("--rail-shift", `${open / 2}px`);
      el.style.setProperty("--rail-inset", railSlide.current ? "0px" : `${open}px`);
      el.dataset.railMove = railSlide.current ? "slide" : "pad";
    }
    // The analysis and full-workbench surfaces are pages, not the reading
    // column: they make room by width, never by a moving layer.
    for (const el of [
      pane.querySelector<HTMLElement>('.scroll[data-pane="analysis"]'),
      pane.querySelector<HTMLElement>(':scope > .scroll[data-pane="browser"]'),
    ]) {
      el?.style.setProperty("--rail-inset", `${open}px`);
    }
    // The session tab strip sits outside the active pane and is left-aligned:
    // it clears the whole rail, not the half-shift the centred column uses.
    document.querySelector<HTMLElement>(".panetabs")?.style.setProperty("--rail-tab", `${open}px`);
  }, []);
  const measureRail = useCallback(() => {
    const scroller = document.querySelector<HTMLElement>('.pane:not([data-off]) .scroll[data-pane="flow"]');
    const flow = scroller?.querySelector<HTMLElement>(".flow");
    if (!scroller || !flow) return;
    // Only the standard reading width has a fixed cap. The full and custom
    // widths follow the room, so opening the rail narrows them: those reflow.
    const measure = document.documentElement.dataset.measure;
    const cap = measure ? NaN : parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--column"));
    if (railShell.current.drawer || !Number.isFinite(cap) || cap <= 0) {
      railSlide.current = false;
    } else {
      const reserve = parseFloat(getComputedStyle(flow).getPropertyValue("--srail-w")) || 0;
      railSlide.current = scroller.clientWidth - railShell.current.railW - reserve - 34 >= cap - 0.5;
    }
    paintRail();
  }, [paintRail]);
  useLayoutEffect(() => { paintRail(); }, [active, drawer, rail, railW, panes, paintRail]);
  useLayoutEffect(() => { measureRail(); }, [active, drawer, railW, panes, measureRail]);
  useEffect(() => {
    let frame = 0;
    let room: ResizeObserver | null = null;
    let look: MutationObserver | null = null;
    let wait: MutationObserver | null = null;
    const again = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measureRail);
    };
    // The mode follows the room, not the toggle: a resize, a zoom, or a change
    // of reading width can move the column across the cap between toggles.
    const attach = () => {
      const scroller = document.querySelector<HTMLElement>('.pane:not([data-off]) .scroll[data-pane="flow"]');
      if (!scroller) return false;
      measureRail();
      room = new ResizeObserver(again);
      room.observe(scroller, { box: "border-box" });
      look = new MutationObserver(again);
      look.observe(document.documentElement, { attributes: true, attributeFilter: ["data-measure", "style"] });
      return true;
    };
    if (!attach()) {
      // The pane mounts after the first session read; watch for it once.
      wait = new MutationObserver(() => {
        if (attach()) {
          wait?.disconnect();
          wait = null;
        }
      });
      wait.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      cancelAnimationFrame(frame);
      room?.disconnect();
      look?.disconnect();
      wait?.disconnect();
    };
  }, [active, panes, measureRail]);
}
