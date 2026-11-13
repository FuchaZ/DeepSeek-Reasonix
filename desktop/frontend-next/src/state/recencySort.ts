const KEY = "rx-session-recency";
const listeners = new Set<() => void>();

/** How the conversation lists are ordered. `off` is the resting state: a
 *  project's rows read the way the kernel wrote them. The two other values are
 *  the same order in either direction, so one word (最近) covers both and the
 *  arrow beside it says which way round it is. */
export type RecencySort = "off" | "newest" | "oldest";

export function recencySort(): RecencySort {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "newest" || saved === "oldest" ? saved : "off";
  } catch {
    return "off";
  }
}

export function onRecencySortChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRecencySort(mode: RecencySort): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* a private window keeps the choice for this session only */
  }
  listeners.forEach((fn) => fn());
}

/** What a click on 最近 does: newest first, then the other way round, then off.
 *  A sort that can only be turned on needs a second control to turn it round;
 *  one row that cycles is the whole story. */
export function nextRecencySort(mode: RecencySort): RecencySort {
  return mode === "off" ? "newest" : mode === "newest" ? "oldest" : "off";
}
