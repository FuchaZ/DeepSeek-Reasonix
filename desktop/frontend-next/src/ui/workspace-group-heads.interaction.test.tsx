// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, expect, it, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { Workspaces } from "./Workspaces";
import type { TreeWorkspace } from "../port/hub";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

// The head writes the same folded set a row click writes: the harness keeps
// that set the way the window does, so both gestures land in one place.
function draw() {
  const tree: TreeWorkspace[] = [
    { root: "/a", name: "a", remembered: true, sessions: [{ path: "/a/1.jsonl", name: "one", title: "one" }] },
    { root: "/b", name: "b", remembered: true, sessions: [{ path: "/b/2.jsonl", name: "two", title: "two" }] },
    { root: "/auto", name: "auto", remembered: false, auto: true, sessions: [{ path: "/auto/3.jsonl", name: "three", title: "three" }] },
  ];
  const Harness = () => {
    const [folded, setFolded] = useState(new Set<string>());
    const fold = (roots: string[], shut: boolean) => setFolded((prev) => {
      const next = new Set(prev);
      for (const root of roots) { if (shut) next.add(root); else next.delete(root); }
      return next;
    });
    return <Workspaces hub={{} as never} tree={tree} treeRead runtimes={[]} active=""
      folded={folded} onFold={(root, shut) => fold([root], shut)} onFoldAll={fold}
      reload={async () => {}} onOpen={async () => {}} onFocus={() => {}} onClose={async () => {}}
      liveIds={() => []} runs={{}} onRename={() => {}} onError={() => {}}
      adder={{ add: () => {}, close: () => {}, at: null } as never} />;
  };
  render(<Harness />);
}

const head = (group: "projects" | "tasks") =>
  document.querySelector<HTMLButtonElement>(`[data-action="workspace.fold-all"][data-value="${group}"]`)!;

const row = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(".wsrow")].find((el) => el.querySelector(".wsname")?.textContent === name)!;

it("folds the whole projects run from the 项目 head and leaves the task group alone", async () => {
  draw();
  const projects = head("projects");
  expect(projects.getAttribute("aria-expanded")).toBe("true");
  expect(projects.getAttribute("aria-label")).toBe("收起所有项目");
  await userEvent.click(projects);
  // The folder rows fold away with their conversations; the task run stays.
  expect(screen.queryByRole("treeitem", { name: "one" })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: "two" })).toBeNull();
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
  await waitFor(() => expect(row("a")).toBeUndefined());
  expect(projects.getAttribute("aria-expanded")).toBe("false");
  expect(projects.getAttribute("aria-label")).toBe("展开所有项目");
  await userEvent.click(projects);
  expect(screen.getByRole("treeitem", { name: "one" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
});

const folders = () => document.querySelector<HTMLButtonElement>('[data-action="workspace.fold-all"][data-value="folders"]')!;

it("folds and expands every project folder from the header control", async () => {
  draw();
  const button = folders();
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-label")).toBe("收起所有项目会话");
  await userEvent.click(button);
  expect(screen.queryByRole("treeitem", { name: "one" })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: "two" })).toBeNull();
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
  await waitFor(() => expect(screen.queryByText("one")).toBeNull());
  expect(row("a").getAttribute("aria-expanded")).toBe("false");
  expect(row("b").getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(button.getAttribute("aria-label")).toBe("展开所有项目会话");
  await userEvent.click(button);
  expect(screen.getByRole("treeitem", { name: "one" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "two" })).toBeTruthy();
  expect(button.getAttribute("aria-expanded")).toBe("true");
});

it("folds the task group from the 任务 head and leaves the projects alone", async () => {
  draw();
  const tasks = head("tasks");
  expect(tasks.getAttribute("aria-expanded")).toBe("true");
  expect(tasks.getAttribute("aria-label")).toBe("收起所有任务");
  await userEvent.click(tasks);
  expect(screen.queryByRole("treeitem", { name: "three" })).toBeNull();
  expect(screen.getByRole("treeitem", { name: "one" })).toBeTruthy();
  expect(tasks.getAttribute("aria-expanded")).toBe("false");
  expect(tasks.getAttribute("aria-label")).toBe("展开所有任务");
  await userEvent.click(tasks);
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
});

it("hangs task conversations directly under the 任务 head with no folder row", () => {
  draw();
  expect([...document.querySelectorAll(".wsrow")].some((el) => el.querySelector(".wsname")?.textContent === "auto")).toBe(false);
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
});

it("folds a run whose folder holds no session at all", () => {
  const tree: TreeWorkspace[] = [{ root: "/empty", name: "empty", remembered: true, sessions: [] }];
  render(<Workspaces hub={{} as never} tree={tree} treeRead runtimes={[]} active="" folded={new Set()}
    onFold={() => {}} reload={async () => {}} onOpen={async () => {}}
    onFocus={() => {}} onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}}
    onError={() => {}} adder={{ add: () => {}, close: () => {}, at: null } as never} />);
  const projects = head("projects");
  expect(projects.disabled).toBe(false);
  expect(projects.getAttribute("aria-expanded")).toBe("true");
});

// The empty column used to answer with the lone 任务 bar alone; now both runs
// read as runs, each label standing and each saying what it holds.
const labels = () => [...document.querySelectorAll(".wsgroup span")].map((el) => el.textContent);
const notes = () => [...document.querySelectorAll(".ws-none")].map((el) => el.textContent);

function drawTree(tree: TreeWorkspace[]) {
  render(<Workspaces hub={{} as never} tree={tree} treeRead runtimes={[]} active="" folded={new Set()}
    onFold={() => {}} reload={async () => {}} onOpen={async () => {}}
    onFocus={() => {}} onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}}
    onError={() => {}} adder={{ add: () => {}, close: () => {}, at: null } as never} />);
}

it("stands both labels with their empty notes when only the window's own folder exists", () => {
  drawTree([{ root: "/auto", name: "auto", remembered: false, auto: true, sessions: [] }]);
  expect(labels()).toEqual(["项目", "任务"]);
  expect(notes()).toEqual(["暂无项目", "暂无任务"]);
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy(); // the head's + stands whatever the runs show
});

it("offers the first project under 暂无项目 when no folder exists at all", () => {
  drawTree([]);
  expect(labels()).toEqual(["项目", "任务"]);
  expect(notes()).toEqual(["暂无项目", "暂无任务"]);
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy();
});

it("says 暂无任务 under the standing bar when only projects exist", () => {
  drawTree([{ root: "/a", name: "a", remembered: true, sessions: [{ path: "/a/1.jsonl", name: "one", title: "one" }] }]);
  expect(labels()).toEqual(["项目", "任务"]);
  expect(notes()).toEqual(["暂无任务"]);
});

it("waits for the counts before saying the task run is empty", () => {
  drawTree([{ root: "/auto", name: "auto", remembered: false, auto: true, sessions: [], countsComplete: false }]);
  expect(labels()).toEqual(["项目", "任务"]);
  expect(notes()).toEqual(["暂无项目"]);
});

it("folds the empty task run's note from its standing label", async () => {
  drawTree([{ root: "/auto", name: "auto", remembered: false, auto: true, sessions: [] }]);
  const tasks = head("tasks");
  expect(tasks.disabled).toBe(false);
  expect(tasks.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(tasks);
  await waitFor(() => expect(notes()).toEqual(["暂无项目"]));
  expect(tasks.getAttribute("aria-expanded")).toBe("false");
  await userEvent.click(tasks);
  expect(notes()).toEqual(["暂无项目", "暂无任务"]);
});

it("folds 暂无项目 and the first-project offer from the 项目 label", async () => {
  drawTree([]);
  const projects = head("projects");
  expect(projects.disabled).toBe(false);
  await userEvent.click(projects);
  await waitFor(() => expect(notes()).toEqual(["暂无任务"]));
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy(); // the head's + stands whatever the runs show
  await userEvent.click(projects);
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy();
  expect(notes()).toEqual(["暂无项目", "暂无任务"]);
});

const both = () => document.querySelector<HTMLButtonElement>('[data-action="workspace.fold-all"][data-value="both"]')!;

it("shows each label's arrow folded to the right and open pointing down", () => {
  draw();
  const projectsChev = head("projects").querySelector(".wschev")!;
  expect(projectsChev.getAttribute("data-open")).toBe("");
  expect(projectsChev.getAttribute("data-leaf")).toBeNull();
  const tasksChev = head("tasks").querySelector(".wschev")!;
  expect(tasksChev.getAttribute("data-open")).toBe("");
});

it("shows the arrow open on a run the label can fold", () => {
  drawTree([{ root: "/empty", name: "empty", remembered: true, sessions: [] }]);
  const chev = head("projects").querySelector(".wschev")!;
  expect(chev.getAttribute("data-open")).toBe("");
  expect(chev.getAttribute("data-leaf")).toBeNull();
});

it("folds both runs at once from the 任务列表 head", async () => {
  draw();
  const bar = both();
  expect(bar.getAttribute("aria-expanded")).toBe("true");
  await userEvent.click(bar);
  expect(screen.queryByRole("treeitem", { name: "one" })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: "three" })).toBeNull();
  expect(notes()).toEqual([]);
  expect(bar.getAttribute("aria-expanded")).toBe("false");
  expect(head("projects").getAttribute("aria-expanded")).toBe("false");
  expect(head("tasks").getAttribute("aria-expanded")).toBe("false");
  expect(head("projects").querySelector(".wschev")!.getAttribute("data-open")).toBeNull();
  await userEvent.click(bar);
  expect(screen.getByRole("treeitem", { name: "one" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: "three" })).toBeTruthy();
  expect(bar.getAttribute("aria-expanded")).toBe("true");
});

it("folds both empty runs' notes from the 任务列表 head", async () => {
  drawTree([]);
  await userEvent.click(both());
  await waitFor(() => expect(notes()).toEqual([]));
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy(); // the head's + stands whatever the runs show
  await userEvent.click(both());
  expect(notes()).toEqual(["暂无项目", "暂无任务"]);
  expect(document.querySelector('[data-action="workspace.add"]')).toBeTruthy();
});

const GROUP_KIND = "application/x-reasonix-group";
const dragTransfer = () => {
  const transfer = {
    data: "",
    types: [GROUP_KIND],
    effectAllowed: "",
    dropEffect: "",
    setData(_kind: string, value: string) { this.data = value; },
    getData(_kind: string) { return this.data; },
  };
  return transfer;
};

it("swaps the two runs when one label is dragged onto the other", async () => {
  draw();
  const transfer = dragTransfer();
  // The drag rides the whole label row: the carried state and the line sit
  // on the row, not on the fold button itself.
  const lineOf = (button: HTMLButtonElement) => button.closest(".wsgroupline")!;
  const tasks = head("tasks");
  const projects = head("projects");
  fireEvent.dragStart(tasks, { dataTransfer: transfer });
  await waitFor(() => expect(lineOf(tasks).getAttribute("data-dragging")).toBe(""));
  fireEvent.dragOver(projects, { dataTransfer: transfer });
  // The carried run sits below the target, so it lands above it: the line
  // rides the target's top edge, where the run will be.
  await waitFor(() => expect(lineOf(projects).getAttribute("data-drop")).toBe("before"));
  fireEvent.drop(projects, { dataTransfer: transfer });
  expect([...document.querySelectorAll(".wsgroup span")].map((el) => el.textContent)).toEqual(["任务", "项目"]);
  expect(localStorage.getItem("rx-rail-group-order")).toBe("tasks-first");
  // The run the drag carried no longer fades, and no head reads as a target.
  expect(lineOf(tasks).getAttribute("data-dragging")).toBeNull();
  expect(lineOf(projects).getAttribute("data-drop")).toBeNull();
  // The first run is now the tasks run: its conversations lead the tree.
  expect(screen.getAllByRole("treeitem", { name: "three" })[0]!.compareDocumentPosition(screen.getAllByRole("treeitem", { name: "one" })[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  // Dragging back restores the standing order: now the carried run sits
  // above its target, so its line rides the target's bottom edge.
  fireEvent.dragStart(projects, { dataTransfer: transfer });
  fireEvent.dragOver(tasks, { dataTransfer: transfer });
  await waitFor(() => expect(lineOf(tasks).getAttribute("data-drop")).toBe("before"));
  fireEvent.drop(tasks, { dataTransfer: transfer });
  expect([...document.querySelectorAll(".wsgroup span")].map((el) => el.textContent)).toEqual(["项目", "任务"]);
  expect(localStorage.getItem("rx-rail-group-order")).toBe("projects-first");
  localStorage.removeItem("rx-rail-group-order");
});

it("drags the standing labels of an empty tree the same way", () => {
  drawTree([]);
  const transfer = dragTransfer();
  const tasks = head("tasks");
  const projects = head("projects");
  fireEvent.dragStart(tasks, { dataTransfer: transfer });
  fireEvent.drop(projects, { dataTransfer: transfer });
  expect([...document.querySelectorAll(".wsgroup span")].map((el) => el.textContent)).toEqual(["任务", "项目"]);
  expect(notes()).toEqual(["暂无任务", "暂无项目"]);
  localStorage.removeItem("rx-rail-group-order");
});

// A conversation row carries its own kind, so the two drags never cross: the
// label drag swaps runs, the row drag walks the row to where the drop lands.
const SESSION_KIND = "application/x-reasonix-session";
const sessionTransfer = () => {
  const transfer = {
    data: "",
    types: [SESSION_KIND],
    effectAllowed: "",
    dropEffect: "",
    setData(_kind: string, value: string) { this.data = value; },
    getData(_kind: string) { return this.data; },
  };
  return transfer;
};

function drawMoving(hub: unknown, reload: () => Promise<void> = async () => {}) {
  const tree: TreeWorkspace[] = [
    { root: "/a", name: "a", remembered: true, sessions: [
      { path: "/a/1.jsonl", name: "one", title: "one" },
      { path: "/a/2.jsonl", name: "two", title: "two" },
      { path: "/a/3.jsonl", name: "three", title: "three" },
    ] },
    { root: "/b", name: "b", remembered: true, sessions: [{ path: "/b/9.jsonl", name: "nine", title: "nine" }] },
  ];
  render(<Workspaces hub={hub as never} tree={tree} treeRead runtimes={[]} active="" folded={new Set()}
    onFold={() => {}} reload={reload} onOpen={async () => {}}
    onFocus={() => {}} onClose={async () => {}} liveIds={() => []} runs={{}} onRename={() => {}}
    onError={() => {}} adder={{ add: () => {}, close: () => {}, at: null } as never} />);
}

// jsdom has no DragEvent constructor, so the events carry no pointer
// coordinates; the edge the row under the pointer speaks is driven here by
// the rect the handler reads — a target sat low reads "before", one sat high
// reads "after".
const sitAt = (el: HTMLElement, top: number) => {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + 30, height: 30, left: 0, right: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
};

it("moves a conversation onto its neighbour inside the same project", async () => {
  const moves: string[] = [];
  let reloaded = 0;
  drawMoving({
    moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); },
  }, () => { reloaded++; return Promise.resolve(); });
  const transfer = sessionTransfer();
  const one = screen.getByRole("treeitem", { name: "one" });
  const three = screen.getByRole("treeitem", { name: "three" });
  sitAt(three, -100); // pointer reads below the row's middle: the "after" edge
  fireEvent.dragStart(one, { dataTransfer: transfer });
  await waitFor(() => expect(one.getAttribute("data-dragging")).toBe(""));
  fireEvent.dragOver(three, { dataTransfer: transfer });
  await waitFor(() => expect(three.getAttribute("data-drop")).toBe("after"));
  fireEvent.drop(three, { dataTransfer: transfer });
  fireEvent.dragEnd(one, { dataTransfer: transfer });
  // Landing below a row two places down is two kernel swaps, then one reload
  // for the whole gesture.
  await waitFor(() => expect(moves).toEqual(["/a/1.jsonl:1", "/a/1.jsonl:1"]));
  expect(reloaded).toBe(1);
  expect(one.getAttribute("data-dragging")).toBeNull();
  expect(three.getAttribute("data-drop")).toBeNull();
});

it("lands a conversation above its target when the line rides the row's top edge", async () => {
  const moves: string[] = [];
  drawMoving({
    moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); },
  });
  const transfer = sessionTransfer();
  const one = screen.getByRole("treeitem", { name: "one" });
  const three = screen.getByRole("treeitem", { name: "three" });
  sitAt(one, 100); // pointer reads above the row's middle: the "before" edge
  fireEvent.dragStart(three, { dataTransfer: transfer });
  fireEvent.dragOver(one, { dataTransfer: transfer });
  await waitFor(() => expect(one.getAttribute("data-drop")).toBe("before"));
  fireEvent.drop(one, { dataTransfer: transfer });
  fireEvent.dragEnd(three, { dataTransfer: transfer });
  // From the foot to the head is two upward swaps.
  await waitFor(() => expect(moves).toEqual(["/a/3.jsonl:-1", "/a/3.jsonl:-1"]));
});

it("the neighbour's near edge means the other side of it — the row moves one step", async () => {
  // Dropping one on two's upper half would be "before two", where one
  // already sits; the line flips to two's lower side and one lands under it.
  // The complementary gesture is the same fact from below: three on two's
  // lower half lands above two. A painted line never means a move of zero.
  const moves: string[] = [];
  drawMoving({
    moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); },
  });
  const transfer = sessionTransfer();
  const one = screen.getByRole("treeitem", { name: "one" });
  const two = screen.getByRole("treeitem", { name: "two" });
  sitAt(two, 100);
  fireEvent.dragStart(one, { dataTransfer: transfer });
  fireEvent.dragOver(two, { dataTransfer: transfer });
  await waitFor(() => expect(two.getAttribute("data-drop")).toBe("after"));
  fireEvent.drop(two, { dataTransfer: transfer });
  fireEvent.dragEnd(one, { dataTransfer: transfer });
  await waitFor(() => expect(moves).toEqual(["/a/1.jsonl:1"]));
});

it("flips the same way when a conversation is carried upward", async () => {
  const moves: string[] = [];
  drawMoving({
    moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); },
  });
  const transfer = sessionTransfer();
  const three = screen.getByRole("treeitem", { name: "three" });
  const two = screen.getByRole("treeitem", { name: "two" });
  sitAt(two, -100); // lower half of the row just above: "after two" is where three sits
  fireEvent.dragStart(three, { dataTransfer: transfer });
  fireEvent.dragOver(two, { dataTransfer: transfer });
  await waitFor(() => expect(two.getAttribute("data-drop")).toBe("before"));
  fireEvent.drop(two, { dataTransfer: transfer });
  fireEvent.dragEnd(three, { dataTransfer: transfer });
  await waitFor(() => expect(moves).toEqual(["/a/3.jsonl:-1"]));
});

it("a row dropped onto itself still asks nothing", async () => {
  const moves: string[] = [];
  drawMoving({
    moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); },
  });
  const transfer = sessionTransfer();
  const two = screen.getByRole("treeitem", { name: "two" });
  fireEvent.dragStart(two, { dataTransfer: transfer });
  fireEvent.drop(two, { dataTransfer: transfer });
  fireEvent.dragEnd(two, { dataTransfer: transfer });
  await waitFor(() => expect(moves).toEqual([]));
});

it("ignores a conversation dropped into another project's list", async () => {
  const moves: string[] = [];
  drawMoving({ moveSession: async (path: string, direction: number) => { moves.push(`${path}:${direction}`); } });
  const transfer = sessionTransfer();
  const one = screen.getByRole("treeitem", { name: "one" });
  const nine = screen.getByRole("treeitem", { name: "nine" });
  fireEvent.dragStart(one, { dataTransfer: transfer });
  fireEvent.dragOver(nine, { dataTransfer: transfer });
  fireEvent.drop(nine, { dataTransfer: transfer });
  expect(moves).toEqual([]);
  expect(nine.getAttribute("data-drop")).toBeNull();
});
