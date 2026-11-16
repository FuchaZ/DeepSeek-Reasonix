import { useCallback, useState, type DragEvent } from "react";

const KIND = "application/x-reasonix-workspace";

type Edge = "before" | "after";

/** Reordering the remembered projects by dragging a row. The place a drop names
 *  is a project to land before ("" for the end), so the kernel's order after the
 *  call is the one the person dropped and nothing here keeps an order of its own. */
export function useWorkspaceDrag(order: string[], place: (root: string, before: string) => Promise<void>) {
  const [dragging, setDragging] = useState("");
  const [over, setOver] = useState<{ root: string; edge: Edge } | null>(null);

  const mine = (e: DragEvent, root: string) => !!dragging && order.includes(root) && [...(e.dataTransfer?.types ?? [])].includes(KIND);
  const edgeOf = (e: DragEvent): Edge => {
    const box = e.currentTarget.getBoundingClientRect();
    return e.clientY < box.top + box.height / 2 ? "before" : "after";
  };
  /** The side the row will actually land on. A row dropped on the edge it
   *  already sits at would be a move of zero — the line would promise a place
   *  and nothing would happen — so on the neighbour that edge flips: carrying
   *  a row onto the row just below lands under it, onto the row just above
   *  lands over it. Both the painted line and the drop read this one answer. */
  const effectiveEdge = (root: string, edge: Edge): Edge => {
    const from = order.indexOf(dragging);
    const to = order.indexOf(root);
    if (from < 0 || to < 0 || from === to) return edge;
    if (edge === "before" && to === from + 1) return "after";
    if (edge === "after" && to === from - 1) return "before";
    return edge;
  };
  const beforeOf = (root: string, edge: Edge) => (edge === "before" ? root : order[order.indexOf(root) + 1] ?? "");

  const start = useCallback((e: DragEvent, root: string) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(KIND, root);
    setDragging(root);
  }, []);
  const hover = (e: DragEvent, root: string) => {
    if (!mine(e, root)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const edge = effectiveEdge(root, edgeOf(e));
    setOver((was) => (was?.root === root && was.edge === edge ? was : { root, edge }));
  };
  const leave = (root: string) => setOver((was) => (was?.root === root ? null : was));
  const end = useCallback(() => {
    setDragging("");
    setOver(null);
  }, []);
  const drop = (e: DragEvent, root: string) => {
    if (!mine(e, root)) return;
    e.preventDefault();
    const before = beforeOf(root, effectiveEdge(root, edgeOf(e)));
    const from = dragging;
    end();
    const at = order.indexOf(from);
    const stays = before === from || (before === "" ? at === order.length - 1 : order[at + 1] === before);
    if (!stays) void place(from, before);
  };
  return { dragging, over, start, hover, leave, drop, end };
}
