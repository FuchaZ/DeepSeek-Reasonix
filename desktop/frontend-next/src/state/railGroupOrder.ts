const KEY = "rx-rail-group-order";
const listeners = new Set<() => void>();

/** Which of the tree's two standing runs leads: the folders a person chose
 *  (项目) or the folder the window itself opened in (任务). Dragging one
 *  group's label onto the other swaps them; the choice rests here. */
export type RailGroupOrder = "projects-first" | "tasks-first";

export function railGroupOrder(): RailGroupOrder {
  try {
    return localStorage.getItem(KEY) === "tasks-first" ? "tasks-first" : "projects-first";
  } catch {
    return "projects-first";
  }
}

export function onRailGroupOrderChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setRailGroupOrder(order: RailGroupOrder): void {
  try {
    localStorage.setItem(KEY, order);
  } catch {
    /* a private window keeps the choice for this session only */
  }
  listeners.forEach((fn) => fn());
}
