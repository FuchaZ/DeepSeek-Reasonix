import { createContext, useContext } from "react";
import type { AgentPort } from "../port/port";
import type { Adder } from "./addws";
import type { PickerProject } from "./useNewSessionPicker";

/** Everything the composer's project pill needs to name the pane's place and
 *  move it: provided by the pane, consumed by the pill — the data follows the
 *  pane instead of threading through the composer's props. */
export interface ProjectChoiceSurface {
  port: AgentPort;
  /** The pane's machine; the palette offers that machine's remembered projects. */
  host?: string;
  /** The folder this pane works in — the kernel's auto workspace when the pane
   *  was opened with no root at all. */
  root: string;
  /** The transcript was written: a switch starts a fresh conversation and
   *  leaves it behind in its project, so the pill asks first. */
  hasContent: boolean;
  /** GET /workspaces' answer; the kernel refuses to be repointed where false. */
  canSwitch: boolean;
  /** A turn holds the busy gate: the kernel would refuse the switch anyway. */
  running: boolean;
  /** The window's remembered projects, the machine book behind them, and the
   *  folder adder the 创建项目 row hands the question to. */
  projects: PickerProject[];
  adder?: Adder;
  /** The pane re-reads /status after a switch; the kernel pushes one too. */
  onChanged(): void;
  /** The pane re-reads everything it holds, and the window the pane list and
   *  the tree, so the sidebar follows the pane to its new project. */
  onSwitched(): void;
  onError(e: unknown): void;
}

export const ProjectChoiceContext = createContext<ProjectChoiceSurface | null>(null);

export function useProjectChoiceSurface(): ProjectChoiceSurface {
  const surface = useContext(ProjectChoiceContext);
  if (!surface) throw new Error("the project pill needs the pane's choice surface above it");
  return surface;
}
