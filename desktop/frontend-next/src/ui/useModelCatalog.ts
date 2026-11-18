import { useCallback } from "react";
import type { AgentPort, ModelEntry } from "../port/port";

// The default is the machine's, not the pane's: a brokered pane's catalogue
// reports it from a cache that trails a write, so the home machine's own list
// decides which entry carries it.
export function useModelCatalog(
  port: AgentPort,
  home: AgentPort,
  onList: (models: ModelEntry[]) => void,
  onFollowsLastChoice?: (follows: boolean) => void,
) {
  return useCallback(() => {
    const homeList = home === port ? null : home.models("all").catch(() => null);
    const homeFollows = home === port ? null : home.defaultModelPolicy().catch(() => null);
    Promise.all([port.models("all"), homeList, homeFollows])
      .then(([list, homed, follows]) => {
        const def = homed?.find((m) => m.default)?.ref;
        onList(homed && def ? list.map((m) => ({ ...m, default: m.ref === def })) : list);
        if (follows !== null) onFollowsLastChoice?.(follows);
      })
      .catch(() => onList([]));
  }, [port, home, onList, onFollowsLastChoice]);
}
