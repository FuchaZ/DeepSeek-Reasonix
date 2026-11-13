// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "./testkit";
import { MockHub } from "../port/mock_hub";
import type { TreeWorkspace } from "../port/hub";
import { Nav } from "./Nav";
import { Sidebar } from "./Sidebar";
import { NO_PAGING } from "./treewindow";

afterEach(cleanup);

const tree: TreeWorkspace[] = [{ root: "/work/alpha", name: "alpha", remembered: true, sessions: [] }];

function sidebar(onSettings = vi.fn()) {
  const noop = vi.fn();
  render(
    <Sidebar
      onFiles={noop} onView={noop} hub={new MockHub()} collapsed={false} navShown={false} paging={NO_PAGING} tree={tree} treeRead runtimes={[]} runs={{}} active=""
      activeWorkspace={tree[0]} liveIds={() => []} pinned={new Set()} onPin={noop} remotes={null} remoteTrees={{}}
      reloadRemotes={async () => {}} reloadRemoteTrees={async () => {}} readRemoteTree={async () => {}} reloadTree={async () => {}}
      adder={{ busy: false, add: noop, addPath: noop } as never} onOpen={async () => {}} onOpenRemote={async () => {}} onFocusPane={noop} onClosePanes={async () => {}}
      onPause={noop} onArchive={async () => {}} onRename={noop} onCollapse={noop} wallet=""
      onSettings={onSettings} onFeedback={noop} feedbackUnread={0} onFind={noop} onError={noop}
    />,
  );
}

const railNames = () => {
  const props = { at: null, onGo: vi.fn(), onFiles: vi.fn(), onFeedback: vi.fn(), onNew: vi.fn(), feedbackUnread: 0, shown: true, wallet: "", approval: undefined, online: 0, hideAmounts: false, onEdit: vi.fn(), onSearch: vi.fn() };
  const { container, unmount } = render(<Nav {...props} />);
  const names = [...container.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")!);
  unmount();
  return names;
};

it("offers in the sidebar every destination the icon rail offers, under the same name", () => {
  const names = railNames();
  expect(names).toContain("扩展");
  sidebar();
  // The column spells the same rows out under its brand row: one list, drawn
  // twice, so every place the rail offers is offered here too.
  const shown = [...screen.getAllByRole("button")].map((b) => `${b.getAttribute("aria-label") ?? ""} ${b.textContent ?? ""}`);
  const destinations = names.filter((n) => !["设置"].includes(n));
  expect(destinations.length).toBeGreaterThan(0);
  const missing = destinations.filter((n) => !shown.some((s) => s.includes(n)));
  expect(missing).toEqual([]);
});
