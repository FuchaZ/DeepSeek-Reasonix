const KEY = "rx-message-times";
const listeners = new Set<() => void>();

/** Whether each message reveals the time it was sent or sealed when the reader
 *  moves the pointer over it. On by default: the stamps cost nothing and the
 *  setting is the way to have them never drawn at all. */
export function showMessageTimes(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function onMessageTimesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function setShowMessageTimes(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* a private window keeps the choice for this session only */
  }
  listeners.forEach((fn) => fn());
}
