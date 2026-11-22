import { useCallback, useMemo, useState } from "react";
import type { Item } from "../state/session";

/** The tool calls a reader asked to see again at the end of the transcript. A
 *  view over calls the transcript already holds, never a fact of the session:
 *  it is not written anywhere, and a call that is no longer in the transcript —
 *  rewound away, or the pane rebuilt — drops out of the list by itself. */
export function useBroughtResults(items: Item[], revision: number) {
  const [asked, setAsked] = useState<string[]>([]);
  // Tool cards are minted and settled only by events that bump the revision.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const here = useMemo(() => {
    const ids = new Set<string>();
    for (const it of items) if (it.t === "tool" && it.tool.id) ids.add(it.tool.id);
    return ids;
  }, [revision]);
  const ids = useMemo(() => asked.filter((id) => here.has(id)), [asked, here]);
  const bring = useCallback((id: string) => setAsked((was) => [...was.filter((x) => x !== id), id]), []);
  const dismiss = useCallback((id: string) => setAsked((was) => was.filter((x) => x !== id)), []);
  return { ids, bring, dismiss };
}
