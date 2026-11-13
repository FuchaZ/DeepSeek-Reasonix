import { useEffect, useState } from "react";
import type { AgentPort } from "../port/port";

/** How many scheduled runs this kernel holds, for the row that opens them.
 *  Read once per port and kept until the port changes: the count is a label, not
 *  a live reading, and a failed read leaves it absent rather than showing 0. */
export function useScheduledCount(port: AgentPort | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!port) return;
    let live = true;
    setCount(0);
    void port.schedules()
      .then((board) => { if (live) setCount(board.schedules.length); })
      .catch(() => { /* a count that cannot be read is left out */ });
    return () => { live = false; };
  }, [port]);
  return count;
}
