// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { MockHub } from "../port/mock_hub";
import type { RuntimeView, TreeWorkspace } from "../port/hub";
import { Sidebar } from "./Sidebar";
import { NO_PAGING } from "./treewindow";

// Folds are the window's persisted choice, so one test's resting state must
// not be the next test's starting one.
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); localStorage.clear(); });

const tree: TreeWorkspace[] = [{
  root: "/work/alpha", name: "alpha", remembered: true,
  sessions: [
    { path: "/work/alpha/a.jsonl", name: "a", title: "first" },
    { path: "/work/alpha/b.jsonl", name: "b", title: "second" },
  ],
}];

function draw(withRemote = false, runtimes: RuntimeView[] = []) {
  const hub = new MockHub();
  const noop = vi.fn();
  render(
    <Sidebar
      onFiles={noop} onView={noop} hub={hub} collapsed={false} navShown paging={NO_PAGING} tree={tree} treeRead runtimes={runtimes} runs={{}} active=""
      activeWorkspace={tree[0]} liveIds={() => []} pinned={new Set()} onPin={noop}
      remotes={withRemote ? [{ name: "gpu", target: "gpu", status: "connected", workspaces: ["/srv/work"] }] : null}
      remoteTrees={withRemote ? { gpu: [{ root: "/srv/work", name: "Remote project", sessions: [{ path: "/r/s", name: "Remote task" }] }] } : {}}
      reloadRemotes={async () => {}} reloadRemoteTrees={async () => {}}
      readRemoteTree={async () => {}} reloadTree={async () => {}} adder={{ busy: false, add: noop, addPath: noop } as never}
      onOpen={async () => {}} onOpenRemote={async () => {}} onFocusPane={noop} onClosePanes={async () => {}}
      onPause={noop} onArchive={async () => {}} onRename={noop} onCollapse={noop} wallet=""
      onSettings={noop} onFeedback={noop} feedbackUnread={0} onFind={noop} onError={noop}
    />,
  );
}

const scope = (value: string) => document.querySelector(`[data-action="session.filter"][data-value="${value}"]`)!;

it("keeps scope filters quiet without showing local-only totals for a unified list", () => {
  draw();
  for (const value of ["all", "live", "pinned", "archived"]) expect(scope(value).querySelector("b")).toBeNull();
});

it("starts directly with projects instead of a local machine parent", () => {
  draw();
  expect(screen.queryByRole("treeitem", { name: /这台机器/ })).toBeNull();
  // The header's own adder stands above the rows; what the tree must not grow
  // is a parent row for the machine itself.
  expect(screen.getByRole("button", { name: "打开项目" })).toBeTruthy();
  const project = document.querySelector<HTMLElement>(".wsrow")!;
  expect(project.getAttribute("aria-level")).toBe("1");
  expect(project.querySelector(".studio-icon")).toBeTruthy();
  expect(project.querySelector(".rowcount")).toBeNull();
  expect(document.querySelector('.sessrow')?.getAttribute("aria-level")).toBe("2");
});

it("draws no session count on a project row, folded or open", async () => {
  draw();
  await userEvent.click(screen.getByRole("button", { name: "收起所有项目" }));
  expect(document.querySelector(".wsrow .rowcount")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "展开所有项目" }));
});

it("folds local projects from the group head and leaves SSH rows to their own folds", async () => {
  draw(true);
  expect(screen.getByText("first")).toBeTruthy();
  expect(screen.getByText("Remote task")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "收起所有项目" }));
  expect(screen.queryByText("first")).toBeNull();
  expect(screen.getByText("Remote task")).toBeTruthy();
  await userEvent.click(screen.getByRole("treeitem", { name: /Remote project/ }));
  expect(screen.queryByText("Remote task")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "展开所有项目" }));
  expect(screen.getByText("first")).toBeTruthy();
  expect(screen.queryByText("Remote task")).toBeNull();
  await userEvent.click(screen.getByRole("treeitem", { name: /Remote project/ }));
  expect(screen.getByText("Remote task")).toBeTruthy();
});

it("reveals a folded project while searching and disables its head", async () => {
  draw(true);
  await userEvent.click(screen.getByRole("button", { name: "收起所有项目" }));
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索会话 / 项目" }), "first");
  expect(screen.getByText("first")).toBeTruthy();
  const projects = document.querySelector<HTMLButtonElement>('[data-action="workspace.fold-all"][data-value="projects"]')!;
  expect(projects.disabled).toBe(true);
});

it("leaves a remote runtime-only project to its own row when the projects head folds", async () => {
  draw(true, [{ id: "new", base: "/r/new", host: "gpu", root: "/srv/new", name: "Fresh task" }]);
  const target = screen.getByRole("treeitem", { name: "Fresh task" })
    .closest(".wsnode")!.querySelector(".rmtwsrow")!.getAttribute("data-target")!;
  const remoteRow = () => document.querySelector<HTMLElement>(`.rmtwsrow[data-target='${target}']`)!;
  expect(remoteRow().getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "收起所有项目" }));
  expect(remoteRow().getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "Fresh task" })).toBeTruthy();
  await userEvent.click(remoteRow());
  expect(remoteRow().getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("treeitem", { name: "Fresh task" })).toBeNull();
});

it("reports no matches when neither local nor SSH projects match the search", async () => {
  draw(true);
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索会话 / 项目" }), "not-a-project");
  expect(screen.getByText("没有匹配的会话")).toBeTruthy();
});

it("reports an empty unified pinned filter", async () => {
  draw(true);
  await userEvent.click(document.querySelector(".session-filter-trigger")!);
  await userEvent.click(scope("pinned"));
  expect(screen.getByText("没有匹配的会话")).toBeTruthy();
});
