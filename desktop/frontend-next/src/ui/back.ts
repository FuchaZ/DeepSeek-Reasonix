import { useEffect, useRef } from "react";

// System back belongs to the page: settings, menus and previews are state, not
// history, so the shell asks this stack before it leaves the app.
type Layer = { close: () => void };
const layers: Layer[] = [];

/** A page layer system back can close. Layers answer innermost first. */
export function useBack(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const layer = { close: () => closeRef.current() };
    layers.push(layer);
    return () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
    };
  }, [open]);
}

/** takeBack closes the innermost layer and says whether one took the press. */
export function takeBack(): boolean {
  const layer = layers[layers.length - 1];
  if (!layer) return false;
  try {
    layer.close();
  } catch {
    // A layer that throws must not send the press on to the app.
  }
  return true;
}

declare global {
  interface Window {
    __reasonixBack?: () => boolean;
  }
}
