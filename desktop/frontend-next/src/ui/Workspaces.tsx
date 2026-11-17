import { inScope, sessionRuntime } from "./sessionScope";
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from "react";
import { hidesLegacySessions, onHidesLegacySessionsChange } from "../state/prefs";
import { onSessionQuickActionsChange, showsSessionQuickActions } from "../state/sessionQuick";
import { onRecencySortChange, recencySort } from "../state/recencySort";
import { onRailGroupOrderChange, railGroupOrder, setRailGroupOrder } from "../state/railGroupOrder";
import { onRailRunFoldChange, railRunFold, setRailRunFold } from "../state/railRunFold";
import { onRailTimeGroupsChange, railTimeGroups } from "../state/railTimeGroups";
import { dayBucket, monthBuckets } from "./timeBuckets";
import { createPortal } from "react-dom";
import { t } from "../i18n";
import type { TreeSession, TreeWorkspace } from "../port/hub";
import { workspaceContains } from "../port/hub";
import { HttpError } from "../port/http_error";
import { pinToViewport, zoom } from "./place";
import { useRailQuery } from "./railsearch";
import { StudioIcon } from "./StudioIcon";
import { TreeEmpty, TreeReading } from "./TreeReading";
import { ListingProgress } from "./ListingProgress";
import { copyText } from "./CopyButton";
import { sessionInfoText } from "./sessionInfo";
import { saveSessionFile } from "./sessionExport";
import { useTreeKeys } from "./tree";
import { useDismiss } from "./dismiss";
import { asksDelete } from "./keys";
import { clearDraftForSession } from "./drafts";
import { workspaceMenuKeys } from "./WorkspaceOrder";
import { WorkspaceReveal } from "./WorkspaceReveal";
import { SessionMenu } from "./SessionMenu";
import { useSessionMove } from "./useSessionMove";
import { useSessionMoveTo } from "./useSessionMoveTo";
import { dragGhost } from "./dragghost";
import { BlankProjectDialog } from "./BlankProjectDialog";
import { SessionHoverCard } from "./SessionHoverCard";
import { pinnedFirst } from "./pinorder"; import { Hit } from "./Hit";
import { Confirm, removeHint, sessionDeleteHint } from "./WorkspaceConfirm";
import { LeadDot, UnreadCount } from "./UnreadMark";
import { PeerThreadMark } from "./peerthreads";
import { NO_PAGING, atCap, answers, unloaded } from "./treewindow";
import type { WorkspacesProps } from "./workspaceprops";
import { SessionBatch, useSelectedRows } from "./SessionBatch";
import { ProjectsHeader } from "./ProjectsHeader";
import { WorkspaceGroupHead, type GroupDragProps } from "./WorkspaceGroupHeaders";
import { workspaceGroups, groupFold, togglePath } from "./workspaceGroups";
import { workspaceRemoval } from "./workspaceRemove";
import { useWorkspaceDrag } from "./useWorkspaceDrag";
import { SessionTail } from "./SessionAge";
import { SessionArchiveAction, SessionMoreAction, SessionPinAction } from "./SessionRowActions";
import { useSessionMutation, type SessionMutation } from "./useSessionMutation";

const parentOf = (root: string) => root.replace(/[/\\]+$/, "").split(/[/\\]/).slice(-2, -1)[0] ?? "";

// A conversation a pane holds before its first turn is written has only a file
// name; calling it that would show a timestamp where every other row shows words.
const rowLabel = (session: TreeSession) =>
  session.title || (session.runtimeId && !session.turns ? t("common.new_session") : session.name);

// The drag payload of a group-label reorder: only drags that carry it move a
// run, the way the row reorder carries its own kind.
const GROUP_DRAG_KIND = "application/x-reasonix-group";
// A conversation row carries its own kind, so a row can never drop onto a
// group label or a label onto a row: the kinds keep the two gestures apart.
const SESSION_DRAG_KIND = "application/x-reasonix-session";

function WorkspacesView({ hub, tree, treeRead, answered = null, runtimes, active, folded, reload, retry, paging = NO_PAGING, previewLimit = Infinity, onFold, opening = "", onOpen, onFocus, onClose, liveIds, listedIds = liveIds, runs, scope = "all", pinned = new Set(), onPin = () => {}, onPause = () => {}, onBranch, onArchive = async () => {}, onRename, onError, adder, children, hasOtherRows }: WorkspacesProps) {
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState("");
  // The project whose folder an open just found gone: the question is asked about it, not about a removal chosen from the menu.
  const [gone, setGone] = useState("");
  const failIn = (ws: TreeWorkspace, e: unknown) => {
    if (e instanceof HttpError && e.reason?.code === "workspace.folder_missing") { setGone(ws.root); setConfirm(ws.root); } else onError(e);
  };
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // A run's label folds the whole run: the folder rows and every conversation
  // under them — whether or not any folder holds a session. The per-folder
  // chevrons keep their own, persisted fold; this one is the label's, kept in
  // the same store so a reload opens the same shape.
  const collapsedRuns = useSyncExternalStore(onRailRunFoldChange, railRunFold, railRunFold);
  // The row a Delete key asked about. The question replaces that row, so focus
  // goes back to it once the question is gone, or a keyboard is left nowhere.
  const askedByKey = useRef("");
  const needle = useRailQuery();
  useEffect(() => { setSelection((current) => current === null ? null : new Set()); }, [needle, scope]);
  // The projects run's plus: a two-item menu at the pointer's bottom-left —
  // an empty named folder, or a folder the person already has — and the
  // blank-project dialog the first item opens.
  const [projAdd, setProjAdd] = useState<{ x: number; y: number } | null>(null);
  const [blankOpen, setBlankOpen] = useState(false);
  // 项目 rename: a small card asking for the name the sidebar reads by.
  const [renameFor, setRenameFor] = useState<{ root: string; name: string } | null>(null);
  // The projects plus' menu dismisses on anything else: an outside click, a
  // scroll of the tree, Escape.
  useEffect(() => {
    if (!projAdd) return;
    const outside = (ev: MouseEvent) => {
      const menu = document.querySelector(".groupadd");
      if (!menu?.contains(ev.target as Node)) setProjAdd(null);
    };
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") setProjAdd(null); };
    window.addEventListener("mousedown", outside, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousedown", outside, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [projAdd]);
  const toggleSelection = (path: string) => setSelection((current) => togglePath(current, path));
  const treeKeys = useTreeKeys();
  const mutations = useSessionMutation(onError);
  const [editing, setEditing] = useState("");
  const hideLegacy = useSyncExternalStore(onHidesLegacySessionsChange, hidesLegacySessions, hidesLegacySessions);
  const quickActions = useSyncExternalStore(onSessionQuickActionsChange, showsSessionQuickActions, showsSessionQuickActions);
  const recency = useSyncExternalStore(onRecencySortChange, recencySort, recencySort);
  const groupOrder = useSyncExternalStore(onRailGroupOrderChange, railGroupOrder, railGroupOrder);
  const timeGroups = useSyncExternalStore(onRailTimeGroupsChange, railTimeGroups, railTimeGroups);
  const [sessionMenu, setSessionMenu] = useState("");
  const order = useSessionMove(hub, reload, onError, !!needle);
  const moveTo = useSessionMoveTo(hub, tree, reload, rowLabel, () => adder.add());
  const [sessionMenuAt, setSessionMenuAt] = useState({ x: 0, y: 0 });
  const sessionMenuBox = useRef<HTMLDivElement>(null);
  const sessionMenuPortal = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLElement | null>(null);
  const dismissMenu = () => {
    if (menuTrigger.current?.dataset.target === sessionMenu) menuTrigger.current.focus();
    setSessionMenu("");
  };
  const openRowMenu = (root: string, trigger: HTMLElement, at?: { x: number; y: number }) => {
    menuTrigger.current = trigger;
    const anchor = trigger.getBoundingClientRect();
    setSessionMenuAt(at ?? { x: anchor.right + 8, y: anchor.top - 7 });
    setSessionMenu(root);
  };
  useDismiss(!!sessionMenu, sessionMenuBox, dismissMenu, sessionMenuPortal);
  useEffect(() => {
    if (sessionMenu && menuTrigger.current?.dataset.target === sessionMenu) {
      sessionMenuPortal.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus();
    }
  }, [sessionMenu]);
  useLayoutEffect(() => {
    if (sessionMenuPortal.current) pinToViewport(sessionMenuPortal.current, sessionMenuAt.x, sessionMenuAt.y, 12);
  }, [sessionMenu, sessionMenuAt]);
  // Finishing is a transition this run witnessed, not a state a row can hold: a
  // persisted done replays nothing when the window opens or the scope changes.
  const priorRun = useRef<Record<string, string>>({});
  const [justDone, setJustDone] = useState<Set<string>>(new Set());

  // A first sighting only records what the state already was, so a row that is
  // done as it mounts is history and says so silently. Each timer clears only
  // the ids it added, which is why nothing has to be cancelled when `runs`
  // moves on: the animation has already been spent by then.
  useEffect(() => {
    const fresh = newlyDone(priorRun.current, runs);
    if (fresh.length === 0) return;
    setJustDone((prev) => new Set([...prev, ...fresh]));
    window.setTimeout(() => {
      setJustDone((prev) => {
        const next = new Set(prev);
        for (const id of fresh) next.delete(id);
        return next;
      });
    }, 1200);
  }, [runs]);
  // Folders whose next page is being read, or could not be.
  const [paged, setPaged] = useState<Record<string, "loading" | "failed">>({});
  const more = async (root: string) => {
    setPaged((prev) => ({ ...prev, [root]: "loading" }));
    try {
      await paging.more(root);
      setPaged(({ [root]: _, ...rest }) => rest);
    } catch {
      setPaged((prev) => ({ ...prev, [root]: "failed" }));
    }
  };
  const [spread, setSpread] = useState<Set<string>>(new Set());
  // Two folders can share a name — a worktree copy carries the project's own.
  // Only then is the extra word worth the room it takes.
  const twice = new Set(tree.map((w) => w.name).filter((n, i, all) => all.indexOf(n) !== i));

  // A row that is already open is a pane to focus, never a second runtime for
  // one transcript — the kernel refuses that, and it is what forked a recovery
  // branch on every save when two writers shared a file.
  const pick = async (ws: TreeWorkspace, session: TreeSession) => {
    // The tree and runtime list arrive from separate reads. During a close or
    // restore the tree can briefly retain an id that no longer exists; focusing
    // that stale id changes no pane and makes the row look unclickable.
    const held = sessionRuntime(session, runtimes);
    if (held) {
      onFocus(held.id);
      return;
    }
    try {
      await onOpen({ root: session.workspaceRoot || ws.root, sessionPath: session.path });
    } catch (e) {
      failIn(ws, e);
    }
  };

  const startSession = async (ws: TreeWorkspace) => {
    setBusy("new:" + ws.root);
    try {
      await onOpen({ root: ws.root });
    } catch (e) {
      failIn(ws, e);
    } finally {
      setBusy("");
    }
  };

  // The task run's plus: the window's own kind of conversation — no project,
  // no picker; the kernel resolves it into the auto workspace itself.
  const startTaskSession = async () => {
    setBusy("new:");
    try {
      await onOpen({});
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
    }
  };

  // Dragging reorders the whole remembered list, so a search that hides rows turns it off.
  const drag = useWorkspaceDrag(needle ? [] : tree.filter((w) => w.remembered).map((w) => w.root), async (root, before) => {
    try {
      await hub.placeWorkspace(root, before);
      await reload();
    } catch (e) {
      onError(e);
    }
  });

  const panesOf = (root: string) => {
    const workspace = tree.find((ws) => ws.root === root);
    return runtimes.filter((rt) => !rt.host && (workspace ? workspaceContains(workspace, rt.root) : rt.root === root)).map((rt) => rt.id);
  };

  const { removeWorkspaceNow } = workspaceRemoval({
    hub, tree, panesOf, liveIds, onClose, reload, onError,
  });

  const dropWorkspace = async (ws: TreeWorkspace) => {
    if (confirm !== ws.root) {
      setGone("");
      setConfirm(ws.root);
      return;
    }
    setConfirm("");
    setGone("");
    try {
      await removeWorkspaceNow(ws);
      await reload();
    } catch (e) {
      onError(e);
    }
  };

  useEffect(() => {
    const path = askedByKey.current;
    if (!path || confirm === path) return;
    askedByKey.current = "";
    // Another question took over: its own button holds focus now.
    if (confirm) return;
    const rows = treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [];
    for (const el of rows) if (el.dataset.target === path) el.focus();
  }, [confirm, treeKeys.ref]);

  const askDelete = (path: string) => {
    askedByKey.current = path;
    setConfirm(path);
  };

  const mutate = (session: TreeSession, kind: SessionMutation) => {
    if (sessionMenu) dismissMenu();
    const row = [...(treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])].find((el) => el.dataset.target === session.path) ?? null;
    void mutations.run(session.path, kind, row, () => kind === "read" ? hub.markSessionRead(session.path).then(reload) : kind === "pin" ? onPin(session.path) : onArchive(session.path, !session.archived, session.runtimeId));
  };
  const archive = (session: TreeSession) => mutate(session, "archive");

  const dropSession = async (session: TreeSession, withCopies = false) => {
    if (confirm !== session.path) {
      setConfirm(session.path);
      return;
    }
    // The row is about to go, and focus with it: the next row takes it, or the
    // one before when this was the last.
    const rows = [...(treeKeys.ref.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [])];
    const asked = treeKeys.ref.current?.querySelector('[role="alertdialog"]');
    const after = asked ? rows.findIndex((el) => asked.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) : -1;
    const heir = after >= 0 ? rows[after] : rows[rows.length - 1];
    setConfirm("");
    try {
      // An idle pane is closed and waited on, since its runtime holds the
      // transcript's lease until it is down. A running one is left for the
      // kernel to refuse: a delete never stops work in progress.
      if (session.runtimeId && liveIds([session.runtimeId]).length === 0) await onClose([session.runtimeId]);
      // A plain delete keeps copies that hold content the conversation lacks; taking
      // them along removes each first, so a refused copy leaves the conversation in place.
      if (withCopies) for (const copy of session.copies ?? []) await hub.removeSession(copy.path);
      await hub.removeSession(session.path);
      clearDraftForSession("", session.path);
      await reload();
      if (document.activeElement && document.activeElement !== document.body) return;
      (heir?.isConnected ? heir : treeKeys.ref.current?.querySelector<HTMLElement>('[role="treeitem"]'))?.focus();
    } catch (e) {
      onError(e);
    }
  };

  const autoName = async (session: TreeSession) => {
    setBusy("name:" + session.path);
    try {
      const { title } = await hub.autoNameSession(session.path);
      await hub.renameSession(session.path, title);
      await reload();
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
      setSessionMenu("");
    }
  };

  const saveSession = async (session: TreeSession, format: "json" | "md" = "json") => {
    setBusy("export:" + session.path);
    try {
      await saveSessionFile(hub, session, format);
    } catch (e) {
      onError(e);
    } finally {
      setBusy("");
      setSessionMenu("");
    }
  };

  const hit = (ws: TreeWorkspace) => {
    if (!needle) return ws;
    const named = (x: TreeSession) => (x.title || x.name || "").toLowerCase().includes(needle);
    if (ws.name.toLowerCase().includes(needle)) return ws;
    const sessions = ws.sessions.filter(named);
    return sessions.length || ws.countsComplete === false ? { ...ws, sessions } : null;
  };
  /** The newest stamp in a project, for ordering projects among themselves. A
   *  conversation without one is being written right now, which makes its
   *  project the most recent thing in the column. */
  const newest = (ws: TreeWorkspace) => ws.sessions.reduce((at, session) => Math.max(at, session.lastActiveAt ?? Date.now()), 0);
  const searchedTree = needle ? (tree.map(hit).filter(Boolean) as TreeWorkspace[]) : tree;
  // The time-section reading sorts newest first, whichever way the sort
  // control last leaned: the sections themselves are the order.
  const recencyUsed = timeGroups ? "newest" : recency;
  const shownTree = searchedTree
    .map((ws) => ({
      ...ws,
      sessions: pinnedFirst(ws.sessions
        .filter((session) => inScope(session, scope, !!needle, !!session.runtimeId && listedIds([session.runtimeId]).length > 0, pinned.has(session.path), hideLegacy, !!session.runtimeId && runs[session.runtimeId]?.run === "halt"))
        // 最近 reorders the rows the kernel sent, newest first or the other way
        // round; pinned rows still lead. Unsorted leaves the kernel's order be.
        .sort((a, b) => {
          const d = (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0);
          return recencyUsed === "newest" ? d : recencyUsed === "oldest" ? -d : 0;
        }), pinned),
    }))
    .filter((ws) => scope === "all" || ws.sessions.length > 0 || ws.countsComplete === false)
    // 最近 orders the projects too, each by the newest conversation inside it:
    // a project is as recent as the last thing said in it.
    .sort((a, b) => {
      const d = newest(b) - newest(a);
      return recencyUsed === "newest" ? d : recencyUsed === "oldest" ? -d : 0;
    });
  // A fold is a resting-state preference: while a word is being typed it would
  // hide the very rows that word just found.
  const searching = !!needle;
  const loadedRows = (root: string) => tree.find((x) => x.root === root)?.sessions.length ?? 0;
  // What the kernel is asked to count: the archived rows when that is the view,
  // otherwise the active ones, and everything while a word is being searched
  // for, since a search is allowed to find an archived conversation.
  const kernelScope = scope === "archived" ? "archived" : searching ? "" : "active";
  const [asked, setAsked] = useState(needle);
  useEffect(() => {
    if (!needle) return setAsked("");
    const wait = setTimeout(() => setAsked(needle), 250);
    return () => clearTimeout(wait);
  }, [needle]);
  useEffect(() => {
    paging.view({ scope: kernelScope, q: asked });
  }, [paging, kernelScope, asked]);
  const pagedScope = scope === "all" || scope === "archived";
  const visibleSessions = (ws: TreeWorkspace) => needle || scope !== "all" || selection || expanded.has(ws.root)
    ? ws.sessions : ws.sessions.filter((session, index) => index < previewLimit || session.runtimeId === active || session.path === opening);
  /** The project row's checkbox is the folder, not a fold control: picking it
   *  picks every row the folder shows, and picking it again clears them. */
  // Draw order: the two runs in the order a drag left them in.
  const groups = workspaceGroups(shownTree);
  const runOrder: ("projects" | "tasks")[] = groupOrder === "tasks-first" ? ["tasks", "projects"] : ["projects", "tasks"];
  const ordered = runOrder.flatMap((group) => groups[group]);
  // The time-section reading: each run's rows gather under the month of their
  // latest activity — the projects among themselves, the tasks among
  // themselves. The sections are cut here so the render only asks where one
  // begins.
  const projectBuckets = timeGroups ? monthBuckets(groups.projects.map((w) => ({ key: w.root, at: newest(w) }))) : null;
  const taskBuckets = timeGroups
    ? monthBuckets(groups.tasks.flatMap((w) => visibleSessions(w).map((s) => ({ key: s.path, at: s.lastActiveAt ?? Date.now() }))))
    : null;
  const sectionHead = (label: string) => (
    <div className="wstime" role="presentation">{label}</div>
  );
  // The group head and the row must read foldability the same way, or a click
  // on the label can disagree with the chevrons it just moved.
  const hasKids = (ws: TreeWorkspace) => ws.sessions.length > 0 || ws.countsComplete === false || ws.listingState === "degraded" || (pagedScope && unloaded(ws, loadedRows(ws.root)) > 0);
  const projectsFold = groupFold(groups.projects, folded, hasKids);
  const tasksFold = groupFold(groups.tasks, folded, hasKids);
  // A count still in flight is not an empty run: the notes wait for the tree
  // to settle before saying a run holds nothing.
  const settled = tree.every((ws) => ws.countsComplete !== false);
  const tasksEmpty = settled && (groups.tasks.length === 0 || groups.tasks.every((ws) => ws.sessions.length === 0));
  const displayed = ordered.filter((ws) => needle || !folded.has(ws.root))
    .flatMap(visibleSessions);
  const selected = useSelectedRows(displayed, selection, setSelection);
  const otherRows = hasOtherRows ? hasOtherRows(needle, hideLegacy) : !!children;
  // The tree at rest — no query or scope on: this is when an empty run speaks,
  // and its standing label folds what it says.
  const restEmpty = !needle && scope === "all" && treeRead && !otherRows;
  const saveRename = async () => {
    if (!renameFor) return;
    const name = renameFor.name.trim();
    if (!name) return;
    try {
      await hub.setWorkspaceDisplayName(renameFor.root, name);
      setRenameFor(null);
      await reload();
    } catch (e) {
      onError(e);
    }
  };
  const toggleRun = (group: "projects" | "tasks") => setRailRunFold((current) => {
    const next = new Set(current);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    return next;
  });
  // The 任务列表 head folds both runs at once, the same persisted rest store
  // the two labels write: everything but the labels themselves goes away,
  // and a reload opens the same shape.
  const bothFolded = collapsedRuns.has("projects") && collapsedRuns.has("tasks");
  const toggleBothRuns = () => {
    setRailRunFold(!bothFolded ? new Set(["projects", "tasks"]) : new Set());
  };
  // Dragging one group's label onto the other swaps the two runs; the label is
  // the handle, and the swap rests in the group-order store.
  const [groupDrag, setGroupDrag] = useState<{ from: "projects" | "tasks"; over: { group: "projects" | "tasks"; edge: "before" | "after" } | null } | null>(null);
  // The same gesture one level down: a conversation row dragged onto a
  // neighbour of its own project asks for the row's place in that project's
  // order. `root` keeps a row from dropping into another project's list, and
  // `archived` keeps the two orderings from mixing — the move walks one class.
  // `over` carries the edge the pointer is nearest, so the insertion line and
  // the walk the drop asks for name the same place.
  const [sessDrag, setSessDrag] = useState<{ from: string; root: string; archived: boolean; over: { path: string; edge: "before" | "after" } | null } | null>(null);

  // A row's hover, half a second in: the card that says what the conversation
  // is and where its dispatches went. A drag, a search or the picking mode
  // reads as no hover at all.
  const [rowHover, setRowHover] = useState<{ ws: TreeWorkspace; session: TreeSession; rect: DOMRect } | null>(null);
  const hoverTimer = useRef(0);
  // Left armed past the unmount, the waiting hover would set state on a column that is gone.
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);
  const hoverable = !needle && !selection && !sessDrag && !groupDrag;
  const hoverIn = (ws: TreeWorkspace, session: TreeSession, ev: ReactMouseEvent<HTMLElement>) => {
    if (!hoverable) return;
    window.clearTimeout(hoverTimer.current);
    const target = ev.currentTarget;
    hoverTimer.current = window.setTimeout(() => setRowHover({ ws, session, rect: target.getBoundingClientRect() }), 450);
  };
  const hoverOut = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setRowHover(null), 350);
  };
  /** The side of the target the carried run lands on. With two runs the only
   *  outcome is a swap, so this is decided by the standing order: a run
   *  carried up from below lands over its target, one carried down from
   *  above lands under it. The painted line and the drop read this one
   *  answer, so what the eye sees is what the drop does. */
  const carriedEdge = (from: "projects" | "tasks"): "before" | "after" =>
    railGroupOrder() === (from === "projects" ? "projects-first" : "tasks-first") ? "after" : "before";
  const groupDragProps = (group: "projects" | "tasks"): GroupDragProps => ({
    draggable: true,
    onDragStart: (e) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(GROUP_DRAG_KIND, group);
      dragGhost(e, group === "projects" ? t("common.project") : t("session.tasks"));
      setGroupDrag({ from: group, over: null });
    },
    onDragOver: (e) => {
      if (!groupDrag || groupDrag.from === group) return;
      if (![...(e.dataTransfer?.types ?? [])].includes(GROUP_DRAG_KIND)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setGroupDrag((was) => (was?.over?.group === group && was.over.edge === carriedEdge(groupDrag.from) ? was : was ? { ...was, over: { group, edge: carriedEdge(groupDrag.from) } } : was));
    },
    onDragLeave: () => setGroupDrag((was) => (was?.over?.group === group ? { ...was, over: null } : was)),
    onDrop: (e) => {
      if (!groupDrag || groupDrag.from === group) return;
      if (![...(e.dataTransfer?.types ?? [])].includes(GROUP_DRAG_KIND)) return;
      e.preventDefault();
      // Two runs and one possible outcome — the carried run takes the
      // other's place — so the side is a fact about the order, not about
      // where inside the row the pointer was: carried up from below, it
      // lands above the target; carried down from above, it lands below.
      const from = groupDrag.from;
      const edge = carriedEdge(from);
      setGroupDrag(null);
      const first = edge === "before" ? from : group;
      setRailGroupOrder(first === "projects" ? "projects-first" : "tasks-first");
    },
    onDragEnd: () => setGroupDrag(null),
  });
  // One run of the tree: its label, the note an empty run says at rest, and —
  // unless the label folded them away — its rows. The label folds the whole
  // run, folder rows and conversations alike, whether or not any folder holds
  // a session. While a query or scope is on the label stands unclickable, and
  // TreeEmpty says what the view holds instead.
  const renderRun = (group: "projects" | "tasks") => {
    const list = groups[group];
    const fold = group === "projects" ? projectsFold : tasksFold;
    const collapsed = collapsedRuns.has(group);
    return (
      <Fragment key={group}>
        {/* One head for every shape of run: the label folds the whole run —
            the folder rows and every conversation under them — through the
            persisted rest store, so a reload opens the same shape. Remote
            rows on the tree or a scope on the view must not take the fold
            away; the query is the only thing that stands the label
            unclickable, and even then the head reads as its disabled
            button. The row's plus answers its own run: the projects' adds a
            project, the tasks' opens the window's own kind of conversation. */}
        <WorkspaceGroupHead group={group} folded={searching ? fold.folded : collapsed} canFold={!searching} searching={searching}
          onToggle={() => toggleRun(group)} dragProps={groupDragProps(group)}
          dropping={groupDrag?.over?.group === group ? groupDrag.over.edge : undefined} dragging={groupDrag?.from === group}
          onAdd={group === "projects" ? (at) => {
            // The menu's top-left corner sits at the plus button's own
            // bottom-left: the button is the anchor, not the pointer. The
            // rect reads in screen pixels and the menu's fixed position
            // lives inside the page's zoom, so the anchor is divided by it —
            // the same math pinning the other floaters uses.
            const box = at.currentTarget.getBoundingClientRect();
            setProjAdd({ x: box.left / zoom(), y: (box.bottom + 6) / zoom() });
          } : () => void startTaskSession()}
          adding={adder.busy || busy === "new:"} />
        {restEmpty && !collapsed && group === "projects" && list.length === 0 && (
          <>
            <div className="ws-none">{t("session.no_projects_yet")}</div>
            {tree.length === 0 && (
              <button className="projects-open" data-action="workspace.add"
                disabled={adder.busy} onClick={() => adder.add()}><StudioIcon name="folder" />{t("session.open_your_first_project")}</button>
            )}
          </>
        )}
        {restEmpty && !collapsed && group === "tasks" && (list.length === 0 || tasksEmpty) && (
          <div className="ws-none">{t("session.no_tasks_yet")}</div>
        )}
        {/* A fold is a resting-state preference: while a query is on, the rows
            it would hide are the very rows the query just found, so the run
            opens for the search no matter how it was put away. */}
        {(!collapsed || !!needle) && list.map((ws) => {
            // A fold is a resting-state preference; while a query is on it would hide
            // the very rows the query just found.
            const hasChildren = hasKids(ws);
            const visible = visibleSessions(ws);
            const hidden = ws.sessions.length - visible.length;
            const shut = hasChildren && !needle && folded.has(ws.root);
            // Only while the question is on screen: panesOf walks every runtime.
            const doomed = confirm === ws.root ? panesOf(ws.root) : [];
            const busyPanes = liveIds(doomed).length;
            // The section this row opens, when the time reading is on: the
            // first row of its day-bucket in its own run, under the run's label.
            const section = group === "projects"
              ? projectBuckets?.marks.get(ws.root)
              : undefined;
            return (
                <div className="wsnode" key={ws.root} data-current={panesOf(ws.root).includes(active) ? "" : undefined} data-missing={ws.missing ? "" : undefined}>
                {section && sectionHead(section)}
                {/* The 任务 area has no folder row of its own: the head is the label,
                    and its conversations hang directly beneath it. */}
                {!ws.auto && (confirm === ws.root ? (
                  <Confirm
                    what={gone === ws.root ? t("session.folder_gone_remove_from_list", { name: ws.name }) : t("session.remove_name_from_the_list", { name: ws.name })}
                    hint={removeHint(doomed.length, busyPanes)}
                    go={t("common.remove")}
                    danger={busyPanes > 0}
                    onGo={() => void dropWorkspace(ws)}
                    onCancel={() => { setConfirm(""); setGone(""); }}
                  />
                ) : (
                  <div
                    ref={sessionMenu === ws.root ? sessionMenuBox : undefined}
                    data-action-click="workspace.fold"
                    data-action-contextmenu="workspace.menu"
                    data-action-keydown="workspace.menu"
                    data-action-dragstart="workspace.reorder"
                    data-action-dragover="workspace.reorder"
                    data-action-dragleave="workspace.reorder"
                    data-action-drop="workspace.reorder"
                    data-action-dragend="workspace.reorder"
                    data-target={ws.root}
                    data-drop={drag.over?.root === ws.root ? drag.over.edge : undefined}
                    data-dragging={drag.dragging === ws.root ? "" : undefined}
                    draggable={ws.remembered && !needle}
                    onDragStart={(ev) => { drag.start(ev, ws.root); dragGhost(ev, ws.name); }}
                    onDragOver={(ev) => drag.hover(ev, ws.root)}
                    onDragLeave={() => drag.leave(ws.root)}
                    onDrop={(ev) => drag.drop(ev, ws.root)}
                    onDragEnd={drag.end}
                    className="wsrow ds-proj"
                    role="treeitem"
                    aria-level={1}
                    aria-haspopup="menu"
                    aria-expanded={hasChildren ? !shut : undefined}
                    aria-selected={selection ? visible.length > 0 && visible.every((s) => selection.has(s.path)) : undefined}
                    onClick={() => {
                      // Picking is a session-only mode: a folder row takes no
                      // part in it, and its click keeps folding the run.
                      if (selection) return;
                      if (hasChildren) onFold(ws.root, !shut);
                    }}
                    onContextMenu={(ev) => {
                      if ((ev.target as HTMLElement).closest("input, textarea, [role='menu']")) return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      openRowMenu(ws.root, ev.currentTarget, ev.clientX || ev.clientY ? { x: ev.clientX, y: ev.clientY } : undefined);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.target !== ev.currentTarget) return;
                      if (ev.key !== "ContextMenu" && !(ev.shiftKey && ev.key === "F10")) return;
                      ev.preventDefault();
                      ev.stopPropagation();
                      openRowMenu(ws.root, ev.currentTarget);
                    }}
                  >
                    {/* The folder carries the fold itself: an open folder while
                        the run shows, a closed one while it is put away — the
                        row's edge carries no separate fold arrow. */}
                    <StudioIcon name={hasChildren && !shut ? "reveal" : "folder"} />
                    <span className="wsname ds-title" title={ws.root}>
                      {ws.name}
                    </span>
                    {/* A tag is this project's identity, so it takes a second line and the name keeps the row. */}
                    {(ws.isolated || twice.has(ws.name)) && (
                      <span className="wsmeta">
                        <em className="wstag">{ws.isolated ? t("common.isolated") : parentOf(ws.root)}</em>
                      </span>
                    )}
                    <span className="wsacts">
                      {shut && <UnreadCount n={ws.sessions.filter((x) => x.unread).length} />}
                      <span className="rowswap">
                      <span className="rowbtns">
                      <button
                        data-action="session.new"
                        className="wsadd"
                        data-busy={busy === "new:" + ws.root ? "" : undefined}
                        disabled={ws.missing}
                        title={t("common.start_a_new_session_in", { name: ws.name })}
                        aria-label={t("common.start_a_new_session_in", { name: ws.name })}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          void startSession(ws);
                        }}
                      >
                        <StudioIcon name="plus" />
                      </button>
                      <button
                        className="wsmore"
                        data-action="workspace.menu"
                        data-target={ws.root}
                        title={t("common.more_actions")}
                        aria-label={t("common.project_actions_name", { name: ws.name })}
                        aria-expanded={sessionMenu === ws.root}
                        aria-haspopup="menu"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          if (sessionMenu === ws.root) setSessionMenu("");
                          else openRowMenu(ws.root, ev.currentTarget);
                        }}
                      >
                        <StudioIcon name="more" />
                      </button>
                      </span>
                      </span>
                    </span>
                    {sessionMenu === ws.root && createPortal(
                      <div ref={sessionMenuPortal} className="session-pop" role="menu" aria-label={t("common.project_actions")} data-action-keydown="workspace.menu" data-target={ws.root} onKeyDown={workspaceMenuKeys} onClick={(ev) => ev.stopPropagation()}>
                        <div className="session-pop-head">
                          <b>{ws.name}</b>
                          <small className="session-pop-path" title={ws.root}>{ws.root}</small>
                        </div>
                        <div className="session-pop-group">
                          <button role="menuitem" data-action="workspace.rename-start" disabled={ws.missing}
                            onClick={() => { setRenameFor(ws); dismissMenu(); }}>
                            <StudioIcon name="edit" /><span>{t("session.rename_project")}</span>
                          </button>
                          <button role="menuitem" data-action="workspace.pin" data-value={ws.pinned ? "off" : "on"}
                            onClick={() => { void hub.setWorkspacePinned(ws.root, !ws.pinned).then(reload).catch(onError); dismissMenu(); }}>
                            <StudioIcon name="pin" /><span>{t(ws.pinned ? "session.unpin_project" : "session.pin_project")}</span>
                          </button>
                          <button role="menuitem" data-action="workspace.archive-sessions" disabled={visible.length === 0}
                            onClick={() => {
                              for (const row of visibleSessions(ws)) { if (!row.runtimeId) void onArchive(row.path, true); }
                              dismissMenu();
                            }}>
                            <StudioIcon name="archive" /><span>{t("session.archive_project_sessions")}</span>
                          </button>
                        </div>
                        <div className="session-pop-group">
                          <button role="menuitem" data-action="session.selection" data-value="start" disabled={visible.length === 0}
                            onClick={() => { setSelection(new Set(visibleSessions(ws).map((s) => s.path))); dismissMenu(); }}>
                            <StudioIcon name="check" /><span>{t("session.batch_select_sessions")}</span>
                          </button>
                        </div>
                        <WorkspaceReveal ws={ws} hub={hub} dismiss={dismissMenu} onError={onError} />
                        <div className="session-pop-group">
                          <button role="menuitem" data-action="workspace.copy-dir"
                            onClick={() => { void navigator.clipboard.writeText(ws.root).catch(onError); dismissMenu(); }}>
                            <StudioIcon name="copy" /><span>{t("session.copy_project_dir")}</span>
                          </button>
                        </div>
                        <div className="session-pop-group">
                          <button className="danger" role="menuitem" data-action="workspace.remove" onClick={() => { setConfirm(ws.root); dismissMenu(); }}>
                            <StudioIcon name="close" /><span>{t("common.remove_from_the_list")}</span><small>{t("common.keeps_files")}</small>
                          </button>
                        </div>
                      </div>,
                      document.body,
                    )}
                  </div>
                ))}

                {/* 子项自己成一块，才能拿到那条层级引导线。缩进单独说不清楚层级：
                    两级差 18px，扫一眼只读得出“有点错位”。 */}
                {!shut && hasChildren && (
                  <div className="kids">
                {visible.map((session) => sessionRow(session, ws))}

                <ListingProgress workspace={ws} searching={searching} onRetry={retry} />
                {pagedScope && (hidden > 0 || unloaded(ws, loadedRows(ws.root)) > 0) && (
                  hidden === 0 && atCap(loadedRows(ws.root)) ? (
                    <small className="sessnote">{ws.countsComplete === false ? t("session.search_to_find_more_conversations") : t("session.n_older_conversations_use_search", { n: unloaded(ws, loadedRows(ws.root)) })}</small>
                  ) : (
                    <button
                      className="sessmore"
                      disabled={paged[ws.root] === "loading"}
                      data-action="session.more"
                      onClick={() => {
                        setExpanded((current) => new Set(current).add(ws.root));
                        if (unloaded(ws, loadedRows(ws.root)) > 0 && !atCap(loadedRows(ws.root))) void more(ws.root);
                      }}
                    >
                      {paged[ws.root] === "loading"
                        ? t("session.loading")
                        : paged[ws.root] === "failed"
                          ? t("common.failed_to_load_retry")
                          : ws.countsComplete === false ? t("session.show_more") : t("common.show_more_n_left", { n: hidden + unloaded(ws, loadedRows(ws.root)) })}
                    </button>
                  )
                )}
                  </div>
                )}
              </div>
            );
        })}
      </Fragment>
    );
  };
  // The time-section reading replaces the folder tree with one timeline: every
  // listed conversation, newest first, gathered under the day it last moved,
  // each row naming what it belongs to — a project's name, or 任务 for the
  // window's own.
  const flatRows = timeGroups
    ? shownTree
        .flatMap((ws) => visibleSessions(ws).map((session) => ({ session, ws })))
        .sort((a, b) => (b.session.lastActiveAt ?? Date.now()) - (a.session.lastActiveAt ?? Date.now()))
    : [];

  // One conversation row, shared by the folder tree and the flat time
  // reading alike: the flat timeline adds the line naming what the
  // conversation belongs to — a project's name, or 任务 for the window's own.
  const sessionRow = (session: TreeSession, ws: TreeWorkspace, subtitle?: string) => {

                    const on = opening ? session.path === opening : session.runtimeId === active;
                    const run = session.runtimeId ? runs[session.runtimeId]?.run : undefined;
                    if (confirm === session.path) {
                      return (
                        <Confirm
                          key={session.path}
                          what={t("common.delete_name", { name: rowLabel(session) })}
                          hint={sessionDeleteHint(session.copies?.length ?? 0, !!session.runtimeId, !!session.runtimeId && liveIds([session.runtimeId]).length > 0)}
                          go={t("common.delete")}
                          danger
                          alt={(session.copies?.length ?? 0) > 0 ? { label: t("session.delete_with_n_copies", { n: session.copies!.length }), onGo: () => void dropSession(session, true) } : undefined}
                          onGo={() => void dropSession(session)}
                          onCancel={() => setConfirm("")}
                        />
                      );
                    }
                    const versions = session.versions ?? [];
                    const copies = session.copies ?? [];
                    const kept = [...versions.map((s) => ({ s, version: true })), ...copies.map((s) => ({ s, version: false }))];
                    const open = spread.has(session.path);
                    // The month section this conversation opens, when the time
                    // reading is on.
                    // The flat reading cuts its own sections from the render
                    // order; only the folder view marks rows here.
                    const section = subtitle ? undefined : taskBuckets?.marks.get(session.path);
                    return (
                      <Fragment key={session.path}>
                        {section && sectionHead(section)}
                      <div
                        ref={sessionMenu === session.path ? sessionMenuBox : undefined}
                        data-action-click={selection ? "session.selection" : "session.open"}
                        data-action-contextmenu="session.menu"
                        aria-haspopup="menu"
                        data-action-keydown={selection ? ["session.selection"] : ["session.open", "session.delete", "session.menu", "session.move"]}
                        data-target={session.path}
                        className="sessrow sessrow-context ds-row"
                        data-sub={subtitle ? "" : undefined}
                        role="treeitem"
                        aria-level={2}
                        aria-label={rowLabel(session)}
                        onMouseEnter={hoverable ? (ev) => hoverIn(ws, session, ev) : undefined}
                        onMouseLeave={hoverable ? hoverOut : undefined}
                        aria-selected={selection ? selection.has(session.path) : on}
                        data-on={on ? "" : undefined}
                        data-live={session.runtimeId ? "" : undefined}
                        data-run={run === "idle" ? undefined : run}
                        data-unread={session.unread ? "" : undefined}
                        data-just-done={session.runtimeId && justDone.has(session.runtimeId) ? "" : undefined}
                        data-busy={opening === session.path || mutations.pending.has(session.path) ? "" : undefined}
                        data-drop={sessDrag?.over?.path === session.path ? sessDrag.over.edge : undefined}
                        data-dragging={sessDrag?.from === session.path ? "" : undefined}
                        draggable={subtitle || selection || !!needle ? undefined : true}
                        onClick={(ev) => { if (selection) toggleSelection(session.path); else if (ev.detail < 2 && mutations.pending.get(session.path) !== "archive") void pick(ws, session); }}
                        data-action-dblclick={selection ? undefined : "session.rename"}
                        onDoubleClick={(ev) => {
                          if (selection || mutations.pending.has(session.path) || (ev.target as HTMLElement).closest("input, button, [role='menu']")) return;
                          setEditing(session.path);
                        }}
                        onContextMenu={(ev) => {
                          if ((ev.target as HTMLElement).closest("input, textarea, [role='menu']")) return;
                          if (selection || mutations.pending.has(session.path)) { ev.preventDefault(); return; }
                          ev.preventDefault();
                          ev.stopPropagation();
                          openRowMenu(session.path, ev.currentTarget, { x: ev.clientX, y: ev.clientY });
                        }}
                        // Dragging a conversation onto a neighbour reorders it
                        // within its own project — the walk the Alt+arrow keys
                        // already ask for, aimed at the edge the line showed.
                        // The flat time reading sorts by clock, so its rows
                        // drag nothing; a search has no order to move within.
                        onDragStart={subtitle ? undefined : (ev) => {
                          ev.dataTransfer.effectAllowed = "move";
                          ev.dataTransfer.setData(SESSION_DRAG_KIND, session.path);
                          dragGhost(ev, rowLabel(session));
                          setSessDrag({ from: session.path, root: ws.root, archived: !!session.archived, over: null });
                        }}
                        onDragOver={subtitle ? undefined : (ev) => {
                          if (!sessDrag || sessDrag.from === session.path || sessDrag.root !== ws.root) return;
                          if (![...(ev.dataTransfer?.types ?? [])].includes(SESSION_DRAG_KIND)) return;
                          if (!!session.archived !== sessDrag.archived) return;
                          ev.preventDefault();
                          ev.dataTransfer.dropEffect = "move";
                          const box = ev.currentTarget.getBoundingClientRect();
                          // A real drag always carries the pointer's y; a
                          // synthetic one (the tests) reads as the row's top.
                          const y = typeof ev.clientY === "number" ? ev.clientY : 0;
                          let edge = y < box.top + box.height / 2 ? "before" as const : "after" as const;
                          // The line names where the row will land. On the
                          // neighbour that edge would be a move of zero — the
                          // row already sits there — so it flips: carrying a
                          // row onto the row just below lands under it, onto
                          // the row just above lands over it. moveTo reads the
                          // same edge, so what is painted is what happens.
                          const peers = ws.sessions.filter((s) => !!s.archived === !!sessDrag.archived);
                          const from = peers.findIndex((s) => s.path === sessDrag.from);
                          const to = peers.findIndex((s) => s.path === session.path);
                          if (from >= 0 && to >= 0 && from !== to) {
                            if (edge === "before" && to === from + 1) edge = "after";
                            else if (edge === "after" && to === from - 1) edge = "before";
                          }
                          setSessDrag((was) => (was?.over?.path === session.path && was.over.edge === edge ? was : was ? { ...was, over: { path: session.path, edge } } : was));
                        }}
                        onDragLeave={subtitle ? undefined : () => setSessDrag((was) => (was?.over?.path === session.path ? { ...was, over: null } : was))}
                        onDrop={subtitle ? undefined : (ev) => {
                          if (!sessDrag || sessDrag.from === session.path || sessDrag.root !== ws.root) return;
                          if (![...(ev.dataTransfer?.types ?? [])].includes(SESSION_DRAG_KIND)) return;
                          ev.preventDefault();
                          const drag = sessDrag;
                          setSessDrag(null);
                          const dragged = ws.sessions.find((s) => s.path === drag.from);
                          if (!dragged || !!dragged.archived !== !!session.archived) return;
                          if (!drag.over) return;
                          void order.moveTo(dragged, ws.sessions.filter((s) => !!s.archived === !!session.archived), session, drag.over.edge);
                        }}
                        onDragEnd={() => setSessDrag(null)}
                        tabIndex={0}
                        onKeyDown={(ev) => {
                          if (ev.target !== ev.currentTarget) return;
                          if (mutations.pending.has(session.path)) return;
                          if (editing === session.path) return;
                          if (selection) {
                            if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); ev.stopPropagation(); toggleSelection(session.path); }
                            return;
                          }
                          if (ev.key === "ContextMenu" || ev.shiftKey && ev.key === "F10") {
                            ev.preventDefault(); ev.stopPropagation(); openRowMenu(session.path, ev.currentTarget);
                          } else if (ev.altKey && (ev.key === "ArrowUp" || ev.key === "ArrowDown")) {
                            ev.preventDefault(); ev.stopPropagation();
                            const direction = ev.key === "ArrowUp" ? -1 : 1;
                            if (direction === -1 ? order.canMove(ws, session).up : order.canMove(ws, session).down) void order.move(session, direction);
                          } else if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            void pick(ws, session);
                          } else if (asksDelete(ev)) {
                            ev.preventDefault();
                            askDelete(session.path);
                          }
                        }}
                      >
                        {selection && <input type="checkbox" className="session-select" tabIndex={-1} aria-label={t("session.select_session_name", { name: rowLabel(session) })}
                          data-action-click="session.selection" data-action-change="session.selection" data-target={session.path} checked={selection.has(session.path)}
                          onClick={(ev) => ev.stopPropagation()} onChange={() => toggleSelection(session.path)} />}
                        <LeadDot unread={session.unread && run !== "running" && run !== "halt"} />
                        {editing === session.path ? (
                          <input className="sessedit" aria-label={t("common.rename_this_session")} placeholder={t("common.chat_title")} autoFocus
                            defaultValue={session.title || session.name}
                            onClick={(ev) => ev.stopPropagation()}
                            data-action-blur="session.rename" data-action-keydown="session.rename" data-target={session.path}
                            onBlur={(ev) => {
                              const next = ev.currentTarget.value.trim();
                              setEditing("");
                              if (next !== "" && next !== (session.title || session.name).trim()) onRename(session.path, next, "inline");
                            }}
                            onKeyDown={(ev) => {
                              if (ev.key === "Enter") {
                                ev.preventDefault();
                                ev.currentTarget.blur();
                              } else if (ev.key === "Escape") {
                                ev.preventDefault();
                                ev.stopPropagation();
                                ev.currentTarget.value = session.title || session.name;
                                ev.currentTarget.blur();
                              }
                            }} />
                        ) : (
                          <span className="sesstitle ds-title" title={rowLabel(session)}>
                            <span className="sessline"><Hit text={rowLabel(session)} needle={needle} />{session.isolated && <em className="sessarch" title={session.workspaceRoot}>{t("common.isolated")}</em>}{session.archived && <em className="sessarch">{t("common.archived")}</em>}
                            {session.metadataState === "pending" && <em className="sessarch">{t("session.reading_summary")}</em>}
                            {session.metadataState === "error" && <em className="sessarch">{t("session.summary_unavailable")}</em>}
                            </span>
                            {subtitle && <span className="sessub">{subtitle}</span>}
                          </span>
                        )}
                        {!selection && <SessionPinAction target={session.path} title={rowLabel(session)}
                          pinned={pinned.has(session.path)} enabled={quickActions} disabled={mutations.pending.has(session.path)} onPin={() => mutate(session, "pin")} />}
                        <PeerThreadMark path={session.path} />
                        <SessionTail run={run} at={session.lastActiveAt ?? Date.now()} unread={session.unread} dot={false} />
                        {!selection && <SessionMoreAction target={session.path} disabled={mutations.pending.has(session.path)}
                          onOpen={(trigger) => openRowMenu(session.path, trigger)} />}
                        {quickActions && !selection && <SessionArchiveAction target={session.path} title={rowLabel(session)} archived={!!session.archived}
                          disabled={mutations.pending.has(session.path) || !!session.runtimeId && liveIds([session.runtimeId]).length > 0} onArchive={() => archive(session)} />}
                        {sessionMenu === session.path && (
                          <SessionMenu
                            ref={sessionMenuPortal}
                            session={session}
                            label={rowLabel(session)}
                            live={!!session.runtimeId && liveIds([session.runtimeId]).length > 0}
                            pinned={pinned.has(session.path)}
                            exporting={busy === "export:" + session.path}
                            autoNaming={busy === "name:" + session.path}
                            onPin={() => mutate(session, "pin")}
                            onMarkRead={session.unread ? () => mutate(session, "read") : undefined}
                            onRename={() => { setSessionMenu(""); onRename(session.path, session.title || session.name); }}
                            onAutoName={() => void autoName(session)}
                            onPause={() => { onPause(session.runtimeId!); setSessionMenu(""); }}
                            onClose={() => {
                              const id = session.runtimeId!;
                              setSessionMenu("");
                              void onClose([id]).catch(onError);
                            }}
                            onArchive={() => archive(session)}
                            onBranch={onBranch && session.runtimeId ? () => { setSessionMenu(""); void onBranch(session.runtimeId!, `${rowLabel(session)} · ${t("common.branch")}`).catch(onError); } : undefined}
                            onCopyInfo={() => { void copyText(sessionInfoText(session, session.workspaceRoot || ws.root)).catch(onError); setSessionMenu(""); }}
                            onExport={(format) => void saveSession(session, format)}
                            onBatchSelect={(picked) => { setSessionMenu(""); setSelection(new Set([picked.path])); }}
                            keptCount={kept.length} keptOpen={open} onKept={() => { setSpread((prev) => { const next = new Set(prev); if (open) next.delete(session.path); else next.add(session.path); return next; }); setSessionMenu(""); }}
                            onDelete={() => { askDelete(session.path); setSessionMenu(""); }}
                            onMoveTo={() => { setSessionMenu(""); moveTo.request(session, ws.root); }}
                          />
                        )}
                      </div>
                      {open &&
                        kept.map(({ s: copy, version }) =>
                          confirm === copy.path ? (
                            <Confirm
                              key={copy.path}
                              what={version ? t("session.delete_this_earlier_version") : t("session.delete_this_recovery_copy")}
                              hint={t("common.deletes_it_together_with_its")}
                              go={t("common.delete")}
                              danger
                              onGo={() => void dropSession(copy)}
                              onCancel={() => setConfirm("")}
                            />
                          ) : (
                            <div
                              data-action-click="session.open"
                              data-action-keydown={["session.open", "session.delete"]}
                              data-target={copy.path}
                              key={copy.path}
                              className="sessrow sesscopy ds-row"
                              role="treeitem"
                              aria-level={3}
                              aria-selected={opening === copy.path}
                              data-on={opening === copy.path ? "" : undefined}
                              data-busy={opening === copy.path ? "" : undefined}
                              onClick={() => void pick(ws, copy)}
                              tabIndex={0}
                              onKeyDown={(ev) => {
                                if (ev.target !== ev.currentTarget) return;
                                if (ev.key === "Enter" || ev.key === " ") {
                                  ev.preventDefault();
                                  void pick(ws, copy);
                                } else if (asksDelete(ev)) {
                                  ev.preventDefault();
                                  askDelete(copy.path);
                                }
                              }}
                            >
                              <span className="ds-lead" />
                              <span className="sesstitle ds-title" title={rowLabel(copy)}>
                                <span>{version ? t("session.earlier_version_n_turns", { n: copy.turns ?? 0 }) : t("session.recovery")}</span>
                              </span>
                              <button
                                className="wsdel"
                                data-action="session.delete"
                                data-target={copy.path}
                                title={t("session.delete_this_session")}
                                aria-label={t("session.delete_this_session")}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setConfirm(copy.path);
                                }}
                              >
                                <StudioIcon name="trash" />
                              </button>
                            </div>
                          ),
                        )}
                      </Fragment>
  );
  };

  return (
    <>
      {moveTo.dialog}
      {rowHover && createPortal(
        <SessionHoverCard hub={hub} ws={rowHover.ws} session={rowHover.session} anchor={rowHover.rect}
          onClose={() => setRowHover(null)} onKeepOpen={() => window.clearTimeout(hoverTimer.current)}
          onOpenSession={(path) => { setRowHover(null); void onOpen({ sessionPath: path }); }} />,
        document.body)}
      {projAdd && createPortal(
        <div className="groupadd" role="menu" aria-label={t("session.add_a_new_project")}
          style={{ left: projAdd.x, top: projAdd.y }}>
          <button role="menuitem" data-action="workspace.add-blank" disabled={adder.busy}
            onClick={() => { setProjAdd(null); setBlankOpen(true); }}>
            <StudioIcon name="plus" /><span>{t("session.new_blank_project")}</span>
          </button>
          <button role="menuitem" data-action="workspace.add-existing" disabled={adder.busy}
            onClick={() => { setProjAdd(null); adder.add(); }}>
            <StudioIcon name="reveal" /><span>{t("session.use_existing_folder")}</span>
          </button>
        </div>, document.body)}
      {blankOpen && createPortal(
        <BlankProjectDialog adder={adder} onDone={async () => { await reload(); }}
          onClose={() => setBlankOpen(false)} onError={onError} />, document.body)}
      {renameFor && createPortal(
        <div className="workspace-blank" role="dialog" aria-label={t("session.rename_project")}>
          <div className="workspace-blank-head">
            <span className="workspace-blank-mark"><StudioIcon name="edit" /></span>
            <button className="workspace-palette-close" aria-label={t("common.close")} data-action="workspace.rename-close" onClick={() => setRenameFor(null)}><StudioIcon name="close" /></button>
          </div>
          <h2>{t("session.rename_project")}</h2>
          <p className="picknote">{renameFor.root}</p>
          <label className="workspace-blank-field">
            <span>{t("session.project_display_name")}</span>
            <input autoFocus data-action-blur="workspace.rename" data-action-change="workspace.rename" data-action-keydown="workspace.rename" value={renameFor.name} onChange={(ev) => setRenameFor({ ...renameFor, name: ev.currentTarget.value })}
              onKeyDown={(ev) => { if (ev.key === "Enter" && renameFor.name.trim()) void saveRename(); }} />
          </label>
          <div className="workspace-blank-go">
            <button data-action="layer.dismiss" onClick={() => setRenameFor(null)}>{t("common.cancel")}</button>
            <button className="pick" data-action="workspace.rename" disabled={!renameFor.name.trim()} onClick={() => void saveRename()}>{t("common.save")}</button>
          </div>
        </div>, document.body)}
      <ProjectsHeader adder={adder} bothFolded={bothFolded} searching={searching} onToggleBoth={() => toggleBothRuns()}
        onSelect={() => setSelection(new Set())} selecting={!!selection} canSelect={displayed.length > 0} />
      <div className="scroll">
        <div role="tree" aria-label={t("session.projects_and_conversations")} aria-multiselectable={selection !== null} inert={busy === "batch"} data-action-keydown="tree.navigate" ref={treeKeys.ref} onKeyDown={treeKeys.onKeyDown}>
          {/* The first run's label stands before its rows even when the run is
              empty, so an empty tree reads as two runs — one for each kind of
              folder — and not as a missing column. */}
          {timeGroups && (() => {
            let section = "";
            return flatRows.map(({ session, ws }) => {
              const bucket = dayBucket(session.lastActiveAt ?? Date.now());
              const opens = bucket.key !== section;
              section = bucket.key;
              return (
                <Fragment key={session.path}>
                  {opens && sectionHead(bucket.label)}
                  {sessionRow(session, ws, ws.auto ? t("session.tasks") : ws.name)}
                </Fragment>
              );
            });
          })()}
          {!timeGroups && runOrder.map((group) => renderRun(group))}
          {!otherRows && shownTree.length === 0 && (tree.length > 0 || treeRead && (!!needle || scope !== "all")) && <TreeEmpty settled={settled && answers(answered, { scope: kernelScope, q: asked })} onRetry={retry} />}
          {tree.length === 0 && !treeRead && <TreeReading onRetry={retry} />}
          {children}
        </div>
      </div>
      <SessionBatch hub={hub} selection={selection} selected={selected} displayed={displayed} onSelect={setSelection}
        onExit={() => {
          // Back to the picking control, or the list's own way in when folded.
          const entry = document.querySelector<HTMLElement>('[data-action="session.selection"][data-value="start"]');
          const target = entry && !entry.hasAttribute("disabled") ? entry : document.querySelector<HTMLElement>('[data-action="workspace.add"]');
          target?.focus();
        }}
        onBusy={(pending) => { setBusy(pending ? "batch" : ""); if (pending) { setSessionMenu(""); setEditing(""); setConfirm(""); } }}
        onClose={onClose} onArchive={onArchive} autoRoot={tree.find((w) => w.auto)?.root}
        liveIds={liveIds} reload={reload} onError={onError} />
    </>
  );
}

// Panes report upward on every usage round, so the window repaints often; the
// tree it holds does not change nearly that often.
export const Workspaces = memo(WorkspacesView);

// Which runs reached "done" since `before` last recorded them. A state is not
// an event: `done` persists, so only a change no first sighting can produce —
// both sides known and different — is the completion this window watched.
export function newlyDone(
  before: Record<string, string>,
  runs: Record<string, { run: string; live: boolean }>,
): string[] {
  const fresh: string[] = [];
  for (const [id, st] of Object.entries(runs)) {
    if (st.run === "done" && before[id] !== undefined && before[id] !== "done") fresh.push(id);
    before[id] = st.run;
  }
  return fresh;
}
