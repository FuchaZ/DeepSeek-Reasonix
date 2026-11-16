import type { RuntimeView } from "../port/hub";
import { useStable, useStableFor } from "./stable";

interface Deps {
  focusPane: (id: string) => void;
  setRail: (open: boolean) => void;
  addFolder: () => void;
  showPrefs: (section?: string) => void;
  setFeedback: (mode: "send") => void;
  runtimes: RuntimeView[];
  openPane: (req: { root?: string; sessionPath?: string }) => Promise<unknown>;
  fail: (e: unknown) => void;
}

/** What each memoized pane is handed. A hidden pane holds a whole transcript, so a
 *  callback that is new every render would make a tab switch redraw all of them;
 *  these keep one identity and run the latest state. */
export function usePaneCallbacks(d: Deps) {
  const focusFor = useStableFor((id: string) => d.focusPane(id));
  const openProject = useStable(() => {
    d.setRail(true);
    d.addFolder();
  });
  const openSettings = useStable((section?: string) => (section ? d.showPrefs(section) : d.showPrefs()));
  const openFeedback = useStable(() => d.setFeedback("send"));
  const openSessionFor = useStableFor(async (id: string, path: string) => {
    const root = d.runtimes.find((r) => r.id === id)?.root;
    await d.openPane({ root, sessionPath: path }).catch(d.fail);
  });
  return { focusFor, openProject, openSettings, openFeedback, openSessionFor };
}
