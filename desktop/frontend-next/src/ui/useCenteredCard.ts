import { useEffect, type RefObject } from "react";
import { pinToViewport } from "./place";

/** Keeps a fixed-position card centred in the viewport, re-centring whenever its
 *  own size changes. Both project dialogs draw the same card shape and have no
 *  anchor to open beside — the sidebar's plus has no hand to lend — so the card
 *  centres itself rather than being pinned from outside. */
export function useCenteredCard(card: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const put = () => {
      const el = card.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      pinToViewport(el, (innerWidth - box.width) / 2, (innerHeight - box.height) / 2, 12);
    };
    put();
    const observer = new ResizeObserver(put);
    if (card.current) observer.observe(card.current);
    return () => observer.disconnect();
  }, [card]);
}
