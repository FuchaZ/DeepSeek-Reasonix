import { useSyncExternalStore } from "react";

/** The one element on the window bar that the docked workbench's tab strip is
 *  drawn into. A registry rather than a looked-up id: the two components sit on
 *  opposite sides of the tree, and an id string is a contract nothing checks —
 *  rename the class and the strip silently stays home. Registered by the chrome
 *  that draws it, read by the panel that fills it. */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** A ref callback: registered on mount, cleared on unmount, and stable across
 *  renders so React does not detach and reattach it every time. */
export function registerDockHead(el: HTMLElement | null) {
  if (slot === el) return;
  slot = el;
  for (const listener of listeners) listener();
}

/** The slot, subscribed: the chrome mounts before or after the panel depending
 *  on the route, so the panel has to hear about it rather than read once. */
export function useDockHead(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot, () => null);
}
