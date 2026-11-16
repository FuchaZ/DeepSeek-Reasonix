const KEY = "rx-rail-time-groups";
const listeners = new Set<() => void>();

/** Whether the tree's two runs read as Steam-like time sections: each run's
 *  rows gather under the calendar month of their latest activity, the current
 *  month first. The clock toggle beside the scope menu flips it; the choice
 *  rests here. */
export function railTimeGroups(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function onRailTimeGroupsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRailTimeGroups(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* a private window keeps the choice for this session only */
  }
  listeners.forEach((fn) => fn());
}
