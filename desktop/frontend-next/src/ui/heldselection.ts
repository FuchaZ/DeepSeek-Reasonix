import { useEffect, useState, type RefObject } from "react";
import { heldBlocks, type Held } from "./chunk_text";

// A block the selection touches must not leave the DOM. Unmounting the node a
// selection is anchored to makes the browser remap that selection onto
// whatever is still mounted — which reads as "I selected up there and the
// bottom got selected too". A block the selection merely passes through, with
// neither end inside it, is held as plain text from the data: mounting its
// cards in one synchronous render is what made a long drag freeze.
export function useHeldSelection(scroll: RefObject<HTMLElement | null>): Map<number, Held> {
  const [held, setHeld] = useState<Map<number, Held>>(new Map());
  useEffect(() => {
    const onSelect = () => {
      const sel = document.getSelection();
      const root = scroll.current;
      if (!root || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        setHeld((prev) => (prev.size ? new Map() : prev));
        return;
      }
      const range = sel.getRangeAt(0);
      if (!root.contains(range.commonAncestorContainer)) return;
      const next = heldBlocks(range, root.querySelectorAll(".chunk"));
      setHeld((prev) => (prev.size === next.size && [...next].every(([i, how]) => prev.get(i) === how) ? prev : next));
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
  }, [scroll]);
  return held;
}
