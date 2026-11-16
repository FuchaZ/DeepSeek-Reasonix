// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeWorkspace } from "../port/hub";

afterEach(cleanup);

// Reordering a project is the row's own drag now — the walk, the no-op drop,
// the bounds and the host failure all live in workspace-drag.interaction.test.
// What is left here is the menu's keyboard and the tree's two sections. Each
// project carries one session so the menu's picking row is enabled and the
// keyboard reads every item.
function draw() {
  const tree: TreeWorkspace[] = ["a", "b", "c"].map((name) => ({
    root: "/" + name, name, remembered: true,
    sessions: [{ path: "/" + name + "/1.jsonl", name: "1", title: name + " one" }],
  }));
  render(<Workspaces hub={{ placeWorkspace: vi.fn().mockResolvedValue(undefined) } as never} tree={tree} treeRead runtimes={[]} active=""
    folded={new Set()} onFold={() => {}} reload={vi.fn().mockResolvedValue(undefined)} onOpen={async () => {}}
    onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}} onFocus={() => {}} onError={() => {}}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
}

it("focuses project menu items and supports Arrow/Home/End/Escape", async () => {
  draw();
  const trigger = screen.getByRole("button", { name: "项目操作：b" });
  await userEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "重命名项目" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "置顶项目" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "归档项目对话" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "批量管理" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "复制项目目录" }));
  await userEvent.keyboard("{ArrowDown}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /移除/ }));
  await userEvent.keyboard("{End}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /移除/ }));
  await userEvent.keyboard("{Home}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "重命名项目" }));
  await userEvent.keyboard("{ArrowUp}");
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: /移除/ }));
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("offers only Remove for an unremembered project", async () => {
  const tree: TreeWorkspace[] = ["a", "b", "c"].map((name) => ({ root: "/" + name, name, remembered: false, sessions: [] }));
  render(<Workspaces hub={{ placeWorkspace: vi.fn() } as never} tree={tree} treeRead runtimes={[]} active=""
    folded={new Set()} onFold={() => {}} reload={vi.fn().mockResolvedValue(undefined)} onOpen={async () => {}}
    onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}} onFocus={() => {}} onError={() => {}}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  await userEvent.click(screen.getByRole("button", { name: "项目操作：b" }));
  // 选择本机会话 stays a header control; the menu's own way into picking is
  // 批量管理, disabled where the folder shows nothing to pick.
  expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
    "重命名项目", "置顶项目", "归档项目对话", "批量管理", "复制项目目录", "从列表移除不删除文件",
  ]);
  expect(screen.getByRole("menuitem", { name: /移除/ })).toBeTruthy();
});

it("reads as two sections: the projects run, then the kernel's own folder", () => {
  // The kernel can list its own folder before the projects; the draw order is
  // the view's, so the tree must still run 项目 above 任务 — and the auto
  // folder itself draws no row: its sessions hang straight under 任务.
  const tree: TreeWorkspace[] = [
    { root: "/task", name: "task", auto: true, sessions: [{ path: "/task/t.jsonl", name: "t", title: "t" }] },
    { root: "/a", name: "a", remembered: true, sessions: [] },
  ];
  render(<Workspaces hub={{ placeWorkspace: vi.fn() } as never} tree={tree} treeRead runtimes={[]} active=""
    folded={new Set()} onFold={() => {}} reload={vi.fn().mockResolvedValue(undefined)} onOpen={async () => {}}
    onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}} onFocus={() => {}} onError={() => {}}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  // The row's own name cell is what is asserted — the whole row would drag
  // the right-hand age (刚刚 and friends) into the comparison.
  const rows = [...document.querySelector('[role="tree"]')!.querySelectorAll(".wsgroup, [role='treeitem']")]
    .map((el) => el.querySelector(".ds-title")?.textContent ?? el.textContent);
  expect(rows).toEqual(["项目", "a", "任务", "t"]);
});

it("reports a host write failure without pretending the order changed", async () => {
  // Kept here as the menu-era name's heir: the failure path itself is the
  // drag's, covered in workspace-drag.interaction.test.
  const tree: TreeWorkspace[] = ["a", "b", "c"].map((name) => ({ root: "/" + name, name, remembered: true, sessions: [] }));
  const placeWorkspace = vi.fn().mockRejectedValue(new Error("write failed"));
  const reload = vi.fn().mockResolvedValue(undefined);
  const onError = vi.fn();
  render(<Workspaces hub={{ placeWorkspace } as never} tree={tree} treeRead runtimes={[]} active=""
    folded={new Set()} onFold={() => {}} reload={reload} onOpen={async () => {}}
    onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}} onFocus={() => {}} onError={onError}
    adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  const dt = { types: ["application/x-reasonix-workspace"], setData() {}, getData: () => "" };
  const rowOf = (name: string) => screen.getByText(name, { selector: ".wsrow *" }).closest(".wsrow") as HTMLElement;
  fireEvent.dragStart(rowOf("c"), { dataTransfer: dt });
  fireEvent.dragOver(rowOf("a"), { dataTransfer: dt });
  fireEvent.drop(rowOf("a"), { dataTransfer: dt });
  await waitFor(() => expect(onError).toHaveBeenCalledOnce());
  expect(reload).not.toHaveBeenCalled();
});
