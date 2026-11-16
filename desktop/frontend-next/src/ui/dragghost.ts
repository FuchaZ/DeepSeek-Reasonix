/** The drag's own picture: the browser would otherwise snapshot the whole row
 *  — every name, count and action button in it — and drag that translucent
 *  photograph around, which is the slow part of a drag on a long sidebar. One
 *  small chip with the row's name drags like the row means it. */
export function dragGhost(ev: { dataTransfer?: { setDragImage?(el: Element, x: number, y: number): void } | null }, label: string): void {
  const el = document.createElement("span");
  el.className = "drag-ghost";
  el.textContent = label;
  el.style.position = "absolute";
  el.style.left = "-9999px";
  el.style.top = "0";
  document.body.appendChild(el);
  try {
    ev.dataTransfer?.setDragImage?.(el, 14, 14);
  } catch {
    /* a dataTransfer without images drags the row's own snapshot */
  }
  // The browser reads the picture at dragstart; the element's job is done.
  setTimeout(() => el.remove(), 0);
}
