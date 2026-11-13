import { FEEDBACK_RETIRED } from "../feedbackchannel";
import { SidebarTools } from "./SidebarTools";
import { SidebarDestinations } from "./SidebarDestinations";
import { FeedbackBadge, feedbackEntryTab } from "./feedbackentry";
import { useEffect, useMemo, useState } from "react";
import { t } from "../i18n";
import logoWordmark from "../assets/logo-wordmark.svg";
import type { ApprovalMode } from "../port/port";
import type { HubPort, RuntimeView, TreeWorkspace } from "../port/hub";
import { workspaceContains } from "../port/hub";
import type { RemoteHost } from "../port/remote";
import type { Adder } from "./addws";
import { ContentMatches } from "./ContentMatches";
import { SECTION_NAME, SETTINGS } from "./prefsnav";
import { RailSearch } from "./railsearch";
import { RemoteHosts, remoteProjectKey, remoteWorkspaces } from "./RemoteHosts";
import { remoteProjects } from "./remoteProjects";
import { StudioIcon } from "./StudioIcon";
import { UpdateNotice } from "./UpdateNotice";
import { useHiddenHosts } from "../state/remotehide";
import { useSidebarFolds } from "../state/sidebarFolds";
import { chord } from "./keys";
import { listenAction } from "./listen";
import { Palette, type Command } from "./Palette";
import { Workspaces } from "./Workspaces";
import { OpenProject } from "./OpenProject";
import type { TreePaging, TreeView } from "./treewindow";
import { useFileDrop } from "./filedrop";
import type { PaneView } from "../state/paneview";
import type { SessionScope } from "./sessionScope";
import { RailFilterContext } from "./railfilter";
import { SessionFilter } from "./SessionFilter";

interface Props {
  hub: HubPort;
  // Collapsed, the column keeps its scroll position and its folds; inert is the
  // other half of that — a column nobody can see must not be reachable by Tab.
  collapsed: boolean;
  navShown: boolean;
  /** Whether the command palette is open, and how to change it. The window owns
   *  this so the icon column can open the same palette; a column drawn on its
   *  own keeps its own. */
  palette?: [boolean, (open: boolean | ((on: boolean) => boolean)) => void];
  tree: TreeWorkspace[];
  treeRead: boolean;
  answered?: TreeView | null;
  runtimes: RuntimeView[];
  runs: Record<string, { run: string; live: boolean }>;
  active: string;
  // Where a new session lands, and the row the tree marks as focused. The window
  // decides it from the focused pane, so it arrives rather than being derived.
  activeWorkspace: TreeWorkspace | undefined;
  liveIds: (ids: string[]) => string[];
  listedIds?: (ids: string[]) => string[];
  // Pins outlive this column — archiving a session drops one — so the set is the
  // window's and only the toggle comes down here.
  pinned: Set<string>;
  onPin: (path: string) => void;
  remotes: RemoteHost[] | null;
  remoteTrees: Record<string, TreeWorkspace[] | null>;
  reloadRemotes: () => Promise<void>;
  reloadRemoteTrees: () => Promise<void>;
  readRemoteTree: (host: string) => Promise<void>;
  reloadTree: () => Promise<void>;
  retryTree?: () => Promise<void>;
  paging: TreePaging;
  adder: Adder;
  opening?: string;
  onOpen: (req: { root?: string; sessionPath?: string }) => Promise<void>;
  onNew?: () => Promise<void>;
  onOpenRemote: (host: string, workspace?: string, sessionPath?: string) => Promise<void>;
  onFocusPane: (id: string) => void;
  onClosePanes: (ids: string[]) => Promise<void>;
  onPause: (runtimeId: string) => void;
  onBranch?: (runtimeId: string, name: string) => Promise<void>;
  onArchive: (path: string, archived: boolean, runtimeId?: string) => Promise<void>;
  onRename: (path: string, title: string, mode?: "inline" | "dialog") => void;
  onCollapse: () => void;
  wallet: string;
  /** How many scheduled runs exist, printed beside 定时运行. */
  schedules?: number;
  /** The focused session's approval mode, named on the tools entry. */
  approval?: ApprovalMode;
  onSettings: (section?: string) => void;
  onFiles: () => void;
  onView: (to: PaneView) => void;
  onReferenceSession?: (id: string, title: string) => void;
  onFeedback: (tab?: "send" | "mine") => void;
  // Reports with a new reply or a question waiting; the entry and the palette say so.
  feedbackUnread: number;
  onFind: () => void;
  onError: (e: unknown) => void;
}

/** The window's left column: what is mounted, what has been said in it, and who
 *  is signed in. It owns only what nothing outside it reads — which scope the
 *  session filter is on, whether the switcher is open, and which workspaces are
 *  folded. Everything else belongs to the window and arrives as a prop. */
export function Sidebar({
  hub,
  collapsed,
  navShown,
  tree,
  treeRead,
  answered,
  runtimes,
  runs,
  active,
  activeWorkspace,
  liveIds,
  listedIds = liveIds,
  pinned,
  onPin,
  remotes,
  remoteTrees,
  reloadRemotes,
  reloadRemoteTrees,
  readRemoteTree,
  reloadTree,
  retryTree,
  paging,
  adder,
  opening,
  onOpen,
  onNew,
  onOpenRemote,
  onFocusPane,
  onClosePanes,
  onPause,
  onBranch,
  onArchive,
  onRename,
  onCollapse,
  wallet,
  schedules,
  approval,
  onSettings,
  onFiles,
  onView,
  onReferenceSession,
  onFeedback,
  feedbackUnread,
  onFind,
  onError,
  palette: controlledPalette,
}: Props) {
  const [railScope, setRailScope] = useState<SessionScope>("all");

  // Owned by the window, not the column: the icon column opens the same palette,
  // and it has to keep working while this column is shut. Drawn on its own, the
  // column keeps the state it always had.
  const [ownPalette, setOwnPalette] = useState(false);
  const [palette, setPalette] = controlledPalette ?? [ownPalette, setOwnPalette];
  const [projectPicker, setProjectPicker] = useState(false);
  const [folded, setFolded] = useSidebarFolds();

  const hiddenHosts = useHiddenHosts();
  // Hidden hosts stay manageable in settings but do not contribute project rows.
  const shownRemotes = useMemo(
    () => (remotes ?? []).filter((host) => !hiddenHosts.includes(host.name)),
    [remotes, hiddenHosts],
  );
  const online = (remotes ?? []).filter((h) => h.status === "connected" || h.status === "degraded").length;
  const newSessionRoot = activeWorkspace?.root;
  const startConversation = () => {
    if (onNew) return onNew();
    const runtime = runtimes.find((rt) => rt.id === active);
    return runtime?.host ? onOpenRemote(runtime.host, runtime.root) : onOpen({ root: newSessionRoot });
  };
  const paletteSettings = useMemo(() => {
    return SETTINGS.filter((x) => !x.hidden).map((x) => ({ id: `${x.section}:${x.anchor}`, label: t(x.title), path: t(SECTION_NAME[x.section] ?? x.section), keywords: (x.keywords ?? []).join(" ") }));
  }, []);
  const scopeCounts = useMemo(() => {
    const open = tree.flatMap((ws) => ws.sessions).filter((x) => !x.archived);
    const running = (x: { runtimeId?: string }) => !!x.runtimeId && runs[x.runtimeId]?.live;
    return {
      all: open.length,
      live: open.filter(running).length,
      waiting: open.filter((x) => !!x.runtimeId && runs[x.runtimeId]?.run === "halt").length,
      unread: open.filter((x) => x.unread).length,
      pinned: open.filter((x) => x.pinned).length,
    };
  }, [tree, runs]);
  const paletteTree = useMemo(() => [...tree, ...shownRemotes.flatMap((host) =>
    remoteWorkspaces(host, remoteTrees[host.name]).map((ws) => ({ ...ws, host: host.name })))], [tree, shownRemotes, remoteTrees]);
  const [over, setOver] = useState(false);
  const drop = useFileDrop((d) => {
    if (collapsed || adder.busy || d.text) return;
    if (d.paths.length !== 1) {
      onError(new Error(d.paths.length ? t("session.drop_one_folder_at_a") : t("session.the_local_path_is_unavailable")));
      return;
    }
    adder.addPath(d.paths[0]);
  }, (on, dt) => setOver(on && !!dt?.types.includes("Files")));

  // The shortcut the button prints. It was drawn and never bound, so the one
  // thing a person learns from the label did nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "k" || e.altKey) return;
      e.preventDefault();
      setPalette((on) => !on);
    };
    return listenAction(window, "keydown", { action: "workspace.search", listener: onKey as EventListener });
  }, []);

  // What the palette can do is what this column already offers, named once so
  // the two cannot drift into two different lists of the same thing.
  const commands = useMemo<Command[]>(
    () => [
      { id: "new", label: t("common.start_a_new_session"), icon: "plus", keywords: "new session chat 新建",
        run: () => void startConversation().catch(onError) },
      { id: "find", label: t("common.find_in_this_conversation"), icon: "search", keywords: "find search conversation 查找 搜索 对话",
        keys: chord("F"), run: onFind },
      { id: "view-flow", label: t("session.show_conversation"), icon: "menu", keywords: "conversation chat flow 对话 会话", keys: chord("1"), run: () => onView("flow") },
      { id: "view-analysis", label: t("session.show_run_analysis"), icon: "list", keywords: "run analysis trace 运行 分析", keys: chord("2"), run: () => onView("analysis") },
      { id: "view-browser", label: t("session.show_workbench"), icon: "panel", keywords: "workbench browser files 工作台 浏览器", keys: chord("3"), run: () => onView("browser") },
      { id: "nav-entries", label: t("settings.navigation_entries"), icon: "settings", keywords: "navigation entries order hide rail 导航 入口 顺序 隐藏 图标", run: () => onSettings("naventries") },
      { id: "files", label: t("common.files"), icon: "file", keywords: "files workspace explorer 文件 工作区", run: onFiles },
      { id: "storage", label: t("common.storage"), icon: "file", keywords: "storage disk data 存储 磁盘 数据",
        run: () => onSettings("storage") },
      { id: "ext", label: t("session.tools_and_integrations"), icon: "plug", keywords: "tools mcp skills 工具 集成",
        run: () => onSettings("extensions") },
      { id: "remote", label: t("session.where_it_runs"), icon: "server", keywords: "ssh local remote 运行环境",
        run: () => onSettings("remote") },
      { id: "providers", label: t("common.model_services"), icon: "layers", keywords: "model provider 模型 来源 服务",
        run: () => onSettings("providers") },
      { id: "usage", label: t("session.wallet_and_usage"), icon: "wallet", keywords: "usage cost token 用量 费用",
        run: () => onSettings("spend") },
      ...(FEEDBACK_RETIRED ? [] : [
        { id: "feedback", label: t("common.send_feedback"), icon: "feedback" as const, keywords: "feedback report bug idea suggestion 反馈 报告 问题 建议 意见",
          run: () => onFeedback("send") },
        { id: "feedback-mine", label: t("session.my_feedback"), icon: "feedback" as const, keywords: "feedback receipt status my reply 反馈 回执 进展 我的 回复",
          status: feedbackUnread > 0 ? t("common.n_to_review", { n: feedbackUnread }) : undefined, run: () => onFeedback("mine") },
      ]),
      { id: "settings", label: t("common.settings"), icon: "settings", keywords: "settings preferences 设置 偏好",
        run: () => onSettings() },
    ],
    [newSessionRoot, onNew, onOpen, onOpenRemote, runtimes, active, onFiles, onView, onSettings, onFeedback, feedbackUnread, onFind, onError],
  );

  const onFold = (root: string, shut: boolean) => {
    const next = new Set(folded);
    if (shut) next.add(root);
    else next.delete(root);
    setFolded(next);
  };
  const foldable = [
    ...tree.filter((ws) => ws.sessions.length || ws.remaining).map((ws) => ws.root),
    ...shownRemotes.flatMap((host) => remoteWorkspaces(host, remoteTrees[host.name], runtimes)
      .filter((ws) => ws.sessions.length || ws.total || !remoteTrees[host.name] || runtimes.some((rt) => rt.host === host.name && workspaceContains(ws, rt.root)))
      .map((ws) => remoteProjectKey(host.name, ws.root))),
  ];
  const allFolded = foldable.length > 0 && foldable.every((key) => folded.has(key));
  const toggleAll = () => setFolded(allFolded
    ? new Set([...folded].filter((key) => !foldable.includes(key))) : new Set([...folded, ...foldable]));

  return (
    <>
    {projectPicker && <OpenProject hub={hub} adder={adder} hosts={shownRemotes}
      onClose={() => setProjectPicker(false)} onError={onError} onOpen={async (host, root) => {
        await onOpenRemote(host, root);
        await reloadRemoteTrees();
      }} />}
    {/* Outside the column's inert wrapper: a collapsed rail must still be
        reachable by the shortcut that opens this. */}
    <Palette
      open={palette}
      onClose={() => setPalette(false)}
      commands={commands}
      tree={paletteTree}
      settings={paletteSettings}
      onOpenSetting={(target) => onSettings(target)}
      runOf={(id) => (id ? runs[id]?.run : undefined)}
      onOpenSession={(path, ws) => void (ws.host ? onOpenRemote(ws.host, ws.root, path) : onOpen({ sessionPath: path })).catch(onError)}
    />
    {/* 收起而不是卸载：卸掉就丢了侧栏的滚动位置、Inspector 的展开、当前选
        中的面板。inert 是「看不见就够不着」那一半 —— 只做视觉隐藏的话，
        屏幕上没有的栏还能被 Tab 走进去。 */}
    <button className="railveil" data-action="chrome.rail" tabIndex={-1} aria-label={t("common.collapse_the_workspace_rail")} onClick={() => onCollapse()} />
    <div className="rail" inert={collapsed} ref={drop}>
      {over && !collapsed && !adder.busy && <div className="rail-drop" role="status"><StudioIcon name="folder" /><span>{t("session.drop_to_add_a_project")}</span></div>}
      <div className="railscroll">
      <div className="studio-rail-head">
        <div className="studio-brand" aria-label="Reasonix Studio">
          <span className="studio-brand-lockup" aria-hidden="true">
            <img className="studio-brand-logo" src={logoWordmark} alt="" draggable={false} />
            <small className="studio-brand-sub">studio</small>
          </span>
          <button type="button" className="studio-collapse" data-action="chrome.rail" title={t("session.collapse_sidebar")} aria-label={t("session.collapse_sidebar")} onClick={() => onCollapse()}>
            <StudioIcon name="panel" />
          </button>
        </div>
        {/* Every row of the bar, the two commands included, is drawn from the
            one list in 更多's keeping — drawing a New session row here as well
            would offer it twice. */}
        {!navShown && <SidebarDestinations wallet={wallet} approval={approval} online={online} schedules={schedules} onGo={onSettings} onFiles={onFiles}
          onNew={() => void startConversation().catch(onError)} onSearch={() => setPalette(true)} />}
      </div>
      <RailFilterContext.Provider value={<SessionFilter scope={railScope} counts={scopeCounts} onScope={setRailScope} />}>
      <RailSearch>
      <ContentMatches hub={hub} tree={tree} onOpen={onOpen} onError={onError} onReference={onReferenceSession} />
      <Workspaces
        hub={hub}
        tree={tree}
        treeRead={treeRead}
        answered={answered}
        runtimes={runtimes}
        active={active}
        folded={folded}
        onToggleAll={toggleAll}
        allFolded={allFolded}
        canFold={foldable.length > 0}
        onFold={onFold}
        reload={reloadTree}
        retry={retryTree ? () => void retryTree() : undefined}
        paging={paging}
        previewLimit={5}
        hasOtherRows={(needle, hideLegacy) => shownRemotes.some((host) => remoteProjects(host, remoteTrees[host.name],
          runtimes, railScope, needle, listedIds, hideLegacy).length > 0)}
        opening={opening}
        onOpen={onOpen}
        onFocus={onFocusPane}
        onClose={onClosePanes}
        liveIds={liveIds}
        listedIds={listedIds}
        runs={runs}
        scope={railScope}
        pinned={pinned}
        onPin={onPin}
        onPause={(runtimeId) => onPause(runtimeId)}
        onBranch={onBranch}
        onArchive={onArchive}
        onRename={onRename}
        onError={onError}
        adder={{ ...adder, add: () => shownRemotes.length ? setProjectPicker(true) : adder.add() }}
      >
        {shownRemotes.some((host) => remoteWorkspaces(host, remoteTrees[host.name]).length > 0 || runtimes.some((rt) => rt.host === host.name)) ? (
          <RemoteHosts
            hub={hub}
            hosts={shownRemotes}
            runtimes={runtimes}
            active={active}
            onOpen={onOpenRemote}
            onFocus={onFocusPane}
            reload={reloadRemotes}
            trees={remoteTrees}
            reloadTrees={reloadRemoteTrees}
            readTree={readRemoteTree}
            onClose={onClosePanes}
            liveIds={liveIds}
            listedIds={listedIds}
            scope={railScope}
            previewLimit={5}
            folded={folded}
            onFold={onFold}
            onError={onError}
          />
        ) : null}
      </Workspaces>
      </RailSearch>
      </RailFilterContext.Provider>
      </div>
      {!navShown && <div className="railfoot">
        <UpdateNotice onOpen={() => onSettings("versions")} />
        <SidebarTools onSettings={onSettings} />
        {!FEEDBACK_RETIRED && (
          <button className="studio-feedback" data-action="feedback.open" onClick={() => onFeedback(feedbackEntryTab(feedbackUnread))}>
            <span aria-hidden="true"><StudioIcon name="feedback" /></span>
            <b>{t("common.send_feedback")}</b>
            <FeedbackBadge unread={feedbackUnread} />
          </button>
        )}
      </div>}
    </div>
    </>
  );
}
