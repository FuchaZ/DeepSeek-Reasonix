import { useRef } from "react";
import type { RuntimeView, TreeWorkspace } from "../port/hub";
import type { RemoteHost } from "../port/remote";
import { remoteWorkspaces } from "./remoteProjects";

export interface PickerProject {
  key: string;
  name: string;
  root: string;
  /** Set for a project saved on another machine: opening it dials that host. */
  host?: string;
}

// The rows the pill offers: the folders this machine remembers — a window
// always has a root, and only remembered says it was chosen — then the ones
// saved on each machine in the book. A missing folder cannot open a session,
// and the unremembered row is the 任务 area, not a project.
export function pickerProjects(tree: TreeWorkspace[], remotes: RemoteHost[] | null,
  remoteTrees: Record<string, TreeWorkspace[] | null>, runtimes: RuntimeView[]): PickerProject[] {
  const local = tree.filter((ws) => ws.remembered && !ws.missing)
    .map((ws) => ({ key: ws.root, name: ws.name, root: ws.root }));
  const remote = (remotes ?? []).flatMap((host) =>
    remoteWorkspaces(host, remoteTrees[host.name], runtimes.filter((rt) => rt.host === host.name))
      .filter((ws) => (ws.remembered || ws.booked) && !ws.missing)
      .map((ws) => ({ key: JSON.stringify([host.name, ws.root]), name: ws.name, root: ws.root, host: host.name })));
  return [...local, ...remote];
}

/** The rows a pane is handed, held by value. The inputs move with every read —
 *  an unread mark clears, a remote's status lands — and a fresh array per read
 *  would redraw every transcript for rows that did not change. */
export function usePickerProjects(tree: TreeWorkspace[], remotes: RemoteHost[] | null,
  remoteTrees: Record<string, TreeWorkspace[] | null>, runtimes: RuntimeView[]): PickerProject[] {
  const next = pickerProjects(tree, remotes, remoteTrees, runtimes);
  const held = useRef(next);
  const steady = held.current.length === next.length
    && next.every((row, i) => {
      const was = held.current[i];
      return was.key === row.key && was.name === row.name && was.root === row.root && was.host === row.host;
    });
  if (!steady) held.current = next;
  return held.current;
}
