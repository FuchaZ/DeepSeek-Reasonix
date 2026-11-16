import { t } from "../i18n";
import { useCallback, useMemo, useState } from "react";
import type { HostCapabilities, HubPort, TreeWorkspace } from "../port/hub";

export interface Adder {
  add: () => void;
  busy: boolean;
  /** True while the headless fallback is asking for a server-side path. */
  pathOpen: boolean;
  addPath: (path: string) => void;
  closePath: () => void;
  /** The system folder picker, for a caller that asks twice — the blank-project
   *  dialog picks the folder a new project is made inside, then adds it apart. */
  pickFolder: (preferred?: string) => Promise<string | null>;
  /** Make an empty, named folder inside `parent` and remember it. The pill's
   *  新建空白项目 uses this; the pane switches itself, so onAdded stays out. */
  addNamed: (name: string, parent: string) => Promise<TreeWorkspace>;
}

const LEGACY_CAPABILITIES: HostCapabilities = { pickFolder: true, addWorkspace: true };

/** useAddWorkspace is the one implementation of "open a project", so the
 *  sidebar's entry and the first-run banner cannot drift into two behaviours.
 *  onAdded is what the owner does with the folder once the tree has re-read it. */
export function useAddWorkspace(
  hub: HubPort,
  reload: () => Promise<void>,
  onError: (e: unknown) => void,
  onAdded?: (workspace: TreeWorkspace) => Promise<void>,
): Adder {
  const [busy, setBusy] = useState(false);
  const [pathOpen, setPathOpen] = useState(false);

  const add = useCallback(
    () => {
      if (busy) return;
      setBusy(true);
      void hub
        .hostCapabilities()
        .catch(() => LEGACY_CAPABILITIES)
        .then(async (capabilities) => {
          if (!capabilities.addWorkspace) {
            throw new Error(t("app.this_kernel_does_not_support"));
          }
          if (!capabilities.pickFolder) {
            setPathOpen(true);
            return;
          }
          const dir = await hub.pickFolder();
          if (dir === null) {
            setPathOpen(true);
            return;
          }
          // "" is the user closing the panel — an answer, not a reason to ask again.
          if (!dir) return;
          const workspace = await hub.addWorkspace(dir);
          await reload();
          await onAdded?.(workspace);
        })
        .catch(onError)
        .finally(() => setBusy(false));
    },
    [busy, hub, reload, onError, onAdded],
  );

  const addPath = useCallback(
    (raw: string) => {
      const path = raw.trim();
      if (busy || !path) return;
      setBusy(true);
      void hub
        .addWorkspace(path)
        .then(async (workspace) => {
          await reload();
          await onAdded?.(workspace);
        })
        .then(() => setPathOpen(false))
        .catch((e) => {
          // The error bar sits above the app; an overlay would hide the reason.
          setPathOpen(false);
          onError(e);
        })
        .finally(() => setBusy(false));
    },
    [busy, hub, reload, onError, onAdded],
  );

  const closePath = useCallback(() => {
    if (!busy) setPathOpen(false);
  }, [busy]);

  const pickFolder = useCallback(
    (preferred?: string) =>
      hub
        .hostCapabilities()
        .catch(() => LEGACY_CAPABILITIES)
        .then((capabilities) => (capabilities.pickFolder ? hub.pickFolder(preferred) : Promise.resolve(null))),
    [hub],
  );

  const addNamed = useCallback(
    async (name: string, parent: string) => {
      const workspace = await hub.addWorkspace(parent, name);
      await reload();
      return workspace;
    },
    [hub, reload],
  );

  return useMemo(() => ({ add, busy, pathOpen, addPath, closePath, pickFolder, addNamed }), [add, busy, pathOpen, addPath, closePath, pickFolder, addNamed]);
}
