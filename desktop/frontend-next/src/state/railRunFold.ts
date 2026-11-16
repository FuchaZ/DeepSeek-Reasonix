const KEY = "rx-rail-run-fold";
const listeners = new Set<() => void>();

// The snapshot is cached: useSyncExternalStore compares by identity, so a
// fresh Set per read would loop the render. The stored string is what the
// cache keys on, so a store cleared underneath (a test, another window)
// reads as a change and rebuilds the set.
let snapshot = new Set<"projects" | "tasks">();
let lastRaw: string | null = null;
let primed = false;

function readStore(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function rebuild(raw: string | null) {
  const set = new Set<"projects" | "tasks">();
  if (raw === "projects" || raw === "tasks") set.add(raw);
  if (raw === "both") { set.add("projects"); set.add("tasks"); }
  snapshot = set;
  lastRaw = raw;
  primed = true;
}

/** Which of the tree's two standing runs each label has folded away. The
 *  per-folder chevrons persist their own fold by root; this one is the run's
 *  rest state, kept by name so a reload opens the same shape. */
export function railRunFold(): Set<"projects" | "tasks"> {
  const raw = readStore();
  if (!primed || raw !== lastRaw) rebuild(raw);
  return snapshot;
}

export function onRailRunFoldChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRailRunFold(next: Set<"projects" | "tasks"> | ((current: Set<"projects" | "tasks">) => Set<"projects" | "tasks">)): void {
  const resolved = typeof next === "function" ? next(railRunFold()) : next;
  try {
    const both = resolved.has("projects") && resolved.has("tasks");
    const one = resolved.has("projects") ? "projects" : resolved.has("tasks") ? "tasks" : "";
    localStorage.setItem(KEY, both ? "both" : one);
  } catch {
    /* a private window keeps the shape for this session only */
  }
  rebuild(readStore());
  listeners.forEach((fn) => fn());
}
