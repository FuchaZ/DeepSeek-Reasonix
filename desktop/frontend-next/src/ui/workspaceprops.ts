import type { ReactNode } from "react";
import type { HubPort, RuntimeView, TreeWorkspace } from "../port/hub";
import type { Adder } from "./addws";
import type { SessionScope } from "./sessionScope";
import type { TreePaging, TreeView } from "./treewindow";

// What the project tree is handed by the window. It lives beside the view rather
// than inside it so the view itself stays about how a row is drawn.
export interface WorkspacesProps {
  hub: HubPort;
  tree: TreeWorkspace[];
  // False until the kernel first answers; an empty tree before then is unread.
  treeRead: boolean;
  answered?: TreeView | null;
  runtimes: RuntimeView[];
  active: string;
  // Collapsed workspaces are the window's own state, not the kernel's, so the
  // sidebar keeps them here rather than asking for them back every reload.
  folded: Set<string>;
  onFold: (root: string, folded: boolean) => void;
  reload: () => Promise<void>;
  retry?: () => void;
  paging?: TreePaging;
  previewLimit?: number;
  onToggleAll?: () => void;
  allFolded?: boolean;
  canFold?: boolean;
  // The session path being opened, or empty. The row shows it selected and busy
  // before the kernel answers; the owner clears it on failure.
  opening?: string;
  onOpen: (req: { root?: string; sessionPath?: string }) => Promise<void>;
  onFocus: (id: string) => void;
  onClose: (ids: string[]) => Promise<void>;
  // Which of these panes are mid-turn. A callback rather than a prop: run state
  // changes constantly and this is only ever asked at confirmation time.
  liveIds: (ids: string[]) => string[];
  // Which of these belong in the running list: the live ones, and the ones that finished within the chosen grace.
  listedIds?: (ids: string[]) => string[];
  runs: Record<string, { run: string; live: boolean }>;
  scope?: SessionScope;
  pinned?: Set<string>;
  onPin?: (path: string) => void;
  onPause?: (runtimeId: string) => void;
  onBranch?: (runtimeId: string, name: string) => Promise<void>;
  onArchive?: (path: string, archived: boolean, runtimeId?: string) => Promise<void>;
  onRename: (path: string, title: string, mode?: "inline" | "dialog") => void;
  onError: (e: unknown) => void;
  // 打开项目这个动作归 App —— 首启那条横幅按的是同一个它。
  adder: Adder;
  // Remote projects share the same tree and keyboard navigation as local ones.
  children?: ReactNode;
  hasOtherRows?: (needle: string, hideLegacy: boolean) => boolean;
}
