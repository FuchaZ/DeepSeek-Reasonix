import { describe, expect, it } from "vitest";
import type { Item } from "../state/session_types";
import type { HistoryMessage } from "../port/session";
import { fromHistory } from "../state/session";
import { foldStats, callLanes, repeatedSpeakers, sameMembers, transcriptRows } from "./turnrows";

const me = (id: string, text: string, pending?: boolean): Item => ({ t: "user", id, text, pending });
const said = (id: string, text: string): Item => ({ t: "say", id, text, done: true });
const ran = (id: string): Item => ({ t: "tool", id, tool: { id, name: "bash" } as never, running: false, children: [] });

const shape = (items: Item[]) =>
  transcriptRows(items).map((r) => ("fold" in r ? `fold:${r.fold.length}` : "item" in r ? `${r.item.t}${r.activity ? `+${r.activity.length}` : ""}` : `work:${r.activity.length}`));

describe("what a turn looks like once it is laid out", () => {
  it("files each run of work under the sentence it followed", () => {
    expect(shape([me("u1", "go"), said("s1", "on it"), ran("t1"), ran("t2"), said("s2", "done")]))
      .toEqual(["user", "say+2", "say"]);
  });

  // A line typed into a running turn used to sit here from the moment it was
  // typed. It split the turn at that point, so every tool call that followed
  // was filed under an instruction the model had not read — the transcript
  // reporting work as done about a line that had not been sent.
  it("leaves a queued line out rather than splitting the turn it was typed into", () => {
    const withQueued = [me("u1", "go"), said("s1", "on it"), me("u2", "also this", true), ran("t1"), said("s2", "done")];
    expect(shape(withQueued)).toEqual(shape([me("u1", "go"), said("s1", "on it"), ran("t1"), said("s2", "done")]));
  });

  it("draws the line as soon as the kernel has taken it", () => {
    expect(shape([me("u1", "go"), said("s1", "on it"), me("u2", "also this")])).toEqual(["user", "say", "user"]);
  });

  // A model that calls tools with no answer yet still streams a message, often
  // with a blank thought. That message draws nothing, so work filed under it
  // would draw nothing either.
  it("files work under the sentence that is drawn, not a blank one before it", () => {
    const blank: Item = { t: "say", id: "s0", text: "", reasoning: "\n", done: true };
    expect(shape([me("u1", "go"), blank, ran("t1"), ran("t2"), said("s1", "found it"), ran("t3"), said("s2", "done")]))
      .toEqual(["user", "say", "say+3", "say"]);
  });

  it("files a started plan's work under its card, and a proposal's nowhere but its sentence", () => {
    const plan = (verdict?: string): Item => ({ t: "approval", id: "p1", a: { id: "a1", tool: "exit_plan_mode", subject: "", kind: "plan" }, verdict });
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan("start"), ran("t1"), ran("t2"), said("s2", "done")]))
      .toEqual(["user", "say", "approval+2", "say"]);
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan(), ran("t1")])).toEqual(["user", "say+1", "approval"]);
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan("revise"), ran("t1")])).toEqual(["user", "say+1", "approval"]);
  });

  it("leaves the plan's own list updates out of the work its card hosts, but not a refused one, and not elsewhere", () => {
    const plan: Item = { t: "approval", id: "p1", a: { id: "a1", tool: "exit_plan_mode", subject: "", kind: "plan" }, verdict: "start" };
    const todo = (id: string, err?: string): Item => ({ t: "tool", id, tool: { id, name: "todo_write", err } as never, running: false, children: [] });
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan, todo("w1"), ran("t1"), todo("w2"), said("s2", "done")]))
      .toEqual(["user", "say", "approval+1", "say"]);
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan, todo("w1"), said("s2", "done")])).toEqual(["user", "say", "approval", "say"]);
    expect(shape([me("u1", "go"), said("s1", "plan:"), plan, todo("w1", "refused")])).toEqual(["user", "say", "approval+1"]);
    expect(shape([me("u1", "go"), said("s1", "on it"), todo("w1"), ran("t1")])).toEqual(["user", "say+2"]);
  });

  it("keeps work under the model that did it while no sentence has come yet", () => {
    const blank: Item = { t: "say", id: "s0", text: "", reasoning: "\n", done: true };
    expect(shape([me("u1", "go"), blank, ran("t1"), ran("t2")])).toEqual(["user", "say+2"]);
  });
});

describe("folding a turn's work under one line", () => {
  const folded = (items: Item[], running = false) =>
    transcriptRows(items, { running }).map((r) => ("fold" in r ? `fold(${r.fold.length})` : "item" in r ? r.item.t : "work"));

  it("leaves only the last sentence outside, with the work and the earlier sentences folded", () => {
    expect(folded([me("u", "q"), said("s1", "let me look"), ran("t1"), said("s2", "found it"), ran("t2"), said("s3", "done")])).toEqual(["user", "fold(2)", "say"]);
  });

  it("folds the work a plan's card hosts and leaves the card where it was", () => {
    const plan: Item = { t: "approval", id: "p1", a: { id: "a1", tool: "exit_plan_mode", subject: "", kind: "plan" }, verdict: "start" };
    expect(folded([me("u", "q"), said("s1", "plan:"), plan, ran("t1"), ran("t2"), said("s2", "found it"), ran("t3"), said("s3", "done")]))
      .toEqual(["user", "fold(1)", "approval", "fold(2)", "say"]);
  });

  it("folds nothing when the turn is just a question and its answer", () => {
    expect(folded([me("u", "q"), said("s1", "answer")])).toEqual(["user", "say"]);
  });

  it("leaves the turn alone while it is still being worked on, and folds it once it is done", () => {
    const items = [me("u", "q"), said("s1", "looking"), ran("t1"), said("s2", "so far")];
    expect(folded(items, true)).toEqual(["user", "say", "say"]);
    expect(folded(items, false)).toEqual(["user", "fold(1)", "say"]);
  });

  it("only the last turn of a running transcript stays open", () => {
    const items = [me("u1", "a"), said("a1", "x"), ran("ta"), said("a2", "done a"), me("u2", "b"), said("b1", "y"), ran("tb"), said("b2", "half")];
    expect(folded(items, true)).toEqual(["user", "fold(1)", "say", "user", "say", "say"]);
  });

  it("treats a steer as the start of what follows, and keeps it where it was said", () => {
    const steer: Item = { t: "user", id: "st", text: "also", steer: true };
    expect(folded([me("u", "q"), said("s1", "a"), ran("t1"), steer, said("s2", "b"), said("s3", "done")])).toEqual(["user", "say", "user", "fold(1)", "say"]);
  });

  it("counts calls and failures for the line that stands in for the work", () => {
    const rows = transcriptRows([me("u", "q"), said("s1", "a"), ran("t1"), ran("t2"), said("s2", "done")], { running: false });
    const fold = rows.find((r) => "fold" in r)!;
    expect("fold" in fold && foldStats(fold.fold, () => 0)).toEqual({ calls: 2, failures: 0, words: 1 });
  });

  it("keeps the last message that has words outside when the turn ends on thinking alone, as a cancelled turn does", () => {
    const thinking: Item = { t: "say", id: "th", text: "", reasoning: "weighing it", done: true };
    expect(folded([me("u", "q"), said("s1", "looking"), ran("t1"), said("s2", "the answer"), thinking])).toEqual(["user", "fold(1)", "say", "say"]);
  });

  it("folds nothing when the turn never got to words (cancelled while thinking, or failed before answering)", () => {
    const thinking: Item = { t: "say", id: "th", text: "", reasoning: "weighing it", done: true };
    expect(folded([me("u", "q"), ran("t1"), thinking])).toEqual(["user", "say"]);
    const notice: Item = { t: "notice", id: "n", level: "error", text: "request failed" } as never;
    expect(folded([me("u", "q"), ran("t1"), notice])).toEqual(["user", "work", "notice"]);
  });

  it("is off unless asked for, so an unconfigured transcript reads as it always did", () => {
    expect(transcriptRows([me("u", "q"), said("s1", "a"), ran("t1"), said("s2", "done")]).some((r) => "fold" in r)).toBe(false);
  });
});

describe("which sentences repeat a speaker already on screen", () => {
  const by = (id: string, model?: string): Item => ({ t: "say", id, text: id, done: true, model });
  const names = (items: Item[]) => [...repeatedSpeakers(items)];

  it("marks every sentence after the first until the user speaks", () => {
    expect(names([me("u1", "a"), by("s1"), ran("t1"), by("s2"), by("s3"), me("u2", "b"), by("s4")])).toEqual(["s2", "s3"]);
  });

  it("keeps the header where the model changes", () => {
    expect(names([me("u1", "a"), by("s1", "m1"), by("s2", "m2"), by("s3", "m2")])).toEqual(["s3"]);
  });

  it("does not let a queued line or an empty sentence reset or stand in", () => {
    expect(names([me("u1", "a"), by("s1"), me("q", "later", true), { t: "say", id: "e", text: "", done: false }, by("s2")])).toEqual(["s2"]);
  });
});

describe("keeping a set when nothing in it changed", () => {
  it("compares members, not references", () => {
    expect(sameMembers(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameMembers(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameMembers(new Set(["a", "c"]), new Set(["a", "b"]))).toBe(false);
  });
});
it("keeps published action surfaces outside work disclosures",()=>{
 const item: Item={t:"tool",id:"surface",running:false,children:[],tool:{id:"call",name:"render_surface",readOnly:true,args:JSON.stringify({spec_version:1,body:[{kind:"button",label:"Continue",actionId:"continue"}]}),output:'{"nonblocking":true}'}};
 expect(transcriptRows([item])).toEqual([{item}]);
});
it("keeps a completed dashboard visible and leaves failed publications as tools", () => {
 const item: Item = { t: "tool", id: "dashboard", running: false, children: [], tool: { name: "render_surface", readOnly: true, args: JSON.stringify({ spec_version: 1, body: [{ kind: "dashboard", dataset: { categories: ["Jan"], series: [{ id: "sales", label: "Sales", values: [10] }] } } ] }), output: "Displayed" } };
 expect(transcriptRows([item])).toEqual([{ item }]);
 const failed = { ...item, tool: { ...item.tool, err: "refused" } };
 expect(transcriptRows([failed])).toEqual([{ activity: [failed] }]);
});

describe("a run of picture calls drawn as one row", () => {
  const shot = (id: string, over: Record<string, unknown> = {}): Item => ({
    t: "tool", id, running: false, children: [],
    tool: { id, name: "view_image", readOnly: true, args: JSON.stringify({ path: `${id}.png` }), images: [`data:image/png;base64,${id}`], ...over } as never,
  });

  it("gathers neighbouring pictures into one lane", () => {
    const lanes = callLanes([shot("a"), shot("b"), shot("c")]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].kind).toBe("pictures");
    expect(lanes[0].kind === "pictures" && lanes[0].calls.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  // One picture under a heading that repeats it is a label where the picture
  // already is, so a lone call keeps its own row.
  it("leaves a single picture as its own row", () => {
    const lanes = callLanes([shot("a")]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].kind).toBe("item");
    expect(lanes[0].kind === "item" && lanes[0].item.id).toBe("a");
  });

  // The run is what is contiguous: a picture, then something else, then another
  // picture is two rows, because the step between them is what each was for.
  it("splits where another call interrupts the run", () => {
    const middle: Item = { t: "tool", id: "m", running: false, children: [], tool: { id: "m", name: "edit_file" } as never };
    const lanes = callLanes([shot("a"), middle, shot("b"), shot("c")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["row:a", "row:m", "pictures:2"]);
  });

  // A failed call carries a reason the row exists to say, and a running one has
  // no picture yet: neither belongs in a group whose row says it succeeded.
  it("keeps a failed or running picture call out of a group", () => {
    const failed = shot("f", { err: "not an image" });
    const live = { ...shot("r"), running: true } as Item;
    const lanes = callLanes([failed, live, shot("a"), shot("b")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["row:f", "row:r", "pictures:2"]);
  });
});

describe("a run of commands drawn as one row", () => {
  const cmd = (id: string, over: Record<string, unknown> = {}): Item => ({
    t: "tool", id, running: false, children: [],
    tool: { id, name: "bash", readOnly: false, args: JSON.stringify({ command: `echo ${id}` }), ...over } as never,
  });

  it("gathers neighbouring commands into one lane", () => {
    const lanes = callLanes([cmd("a"), cmd("b"), cmd("c"), cmd("d")]);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].kind).toBe("commands");
    expect(lanes[0].kind === "commands" && lanes[0].calls.map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("leaves a single command as its own row", () => {
    expect(callLanes([cmd("a")])[0].kind).toBe("item");
  });

  // A command still running is what the reader is waiting on, and a failed one
  // is where the exit status is said: neither is a line of a count.
  it("keeps a running or failed command out of a group", () => {
    const live = { ...cmd("r"), running: true } as Item;
    const failed = cmd("f", { err: "exit 1" });
    const lanes = callLanes([live, failed, cmd("a"), cmd("b")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["row:r", "row:f", "commands:2"]);
  });

  // A background start is a live job, not a finished command: its row carries
  // the job's status and the way to its output, and a count of commands run
  // would say the work was over while it still runs.
  it("keeps a background start out of the group", () => {
    const bg = cmd("bg", { execution: { kind: "shell", state: "background_started", jobId: "j1" } });
    const lanes = callLanes([bg, cmd("a"), cmd("b")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["row:bg", "commands:2"]);
  });

  // A subagent's calls belong inside the delegate that made them.
  it("keeps a subagent's command out of the main flow's group", () => {
    const child = cmd("c", { parentId: "p" });
    const lanes = callLanes([child, cmd("a"), cmd("b")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["row:c", "commands:2"]);
  });

  // The two kinds never share a lane: a picture between two commands ends the
  // command run, because it is a different thing that was done.
  it("does not merge commands across a picture", () => {
    const pic: Item = { t: "tool", id: "p", running: false, children: [],
      tool: { id: "p", name: "view_image", readOnly: true, args: '{"path":"a.png"}', images: ["data:image/png;base64,AA"] } as never };
    const lanes = callLanes([cmd("a"), cmd("b"), pic, cmd("c"), cmd("d")]);
    expect(lanes.map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.length}`)))
      .toEqual(["commands:2", "row:p", "commands:2"]);
  });
});

// Grouping lives above the stored record, so the lanes a reopen draws are the
// lanes the live stream drew. The rebuild below is the production path
// (fromHistory); a shallow copy of live items would only prove the pure
// function against itself.
describe("the same transcript before and after a reopen", () => {
  const call = (id: string, name: string, over: Record<string, unknown> = {}): Item => ({
    t: "tool", id, running: false, children: [],
    tool: { id, name, readOnly: true, args: JSON.stringify({ path: `${id}.png` }), ...over } as never,
  });
  const lanes = (items: Item[]) =>
    callLanes(items).map((l) => (l.kind === "item" ? `row:${l.item.id}` : `${l.kind}:${l.calls.map((c) => c.id).join(",")}`));
  // The rebuild allocates its own item ids; a lane's calls are named by the
  // tool call id, which is the id the store wrote.
  const rebuiltLanes = (items: Item[]) =>
    callLanes(items).map((l) => l.kind === "item"
      ? `row:${l.item.t === "tool" ? l.item.tool.id : l.item.id}`
      : `${l.kind}:${l.calls.map((c) => c.tool.id).join(",")}`);

  it("gathers the stored calls by what each did, pictures included", () => {
    const messages: HistoryMessage[] = [
      {
        role: "assistant", content: "", msgIndex: 0,
        toolCalls: [
          { id: "p1", name: "view_image", arguments: JSON.stringify({ path: "p1.png" }) },
          { id: "p2", name: "view_image", arguments: JSON.stringify({ path: "p2.png" }) },
          { id: "b1", name: "bash", arguments: JSON.stringify({ command: "a" }) },
          { id: "b2", name: "bash", arguments: JSON.stringify({ command: "b" }) },
        ],
      },
      { role: "tool", content: "[image]", toolCallId: "p1", msgIndex: 1, toolImages: ["data:image/png;base64,AA"] },
      { role: "tool", content: "[image]", toolCallId: "p2", msgIndex: 2, toolImages: ["data:image/png;base64,BB"] },
      { role: "tool", content: "a", toolCallId: "b1", msgIndex: 3 },
      { role: "tool", content: "b", toolCallId: "b2", msgIndex: 4 },
    ];
    const live = [
      call("p1", "view_image", { images: ["data:image/png;base64,AA"] }),
      call("p2", "view_image", { images: ["data:image/png;base64,BB"] }),
      call("b1", "bash", { args: JSON.stringify({ command: "a" }) }),
      call("b2", "bash", { args: JSON.stringify({ command: "b" }) }),
    ];
    expect(rebuiltLanes(fromHistory(messages).items)).toEqual(["pictures:p1,p2", "commands:b1,b2"]);
    expect(lanes(live)).toEqual(["pictures:p1,p2", "commands:b1,b2"]);
  });

  // The rebuild path merges lookups into `reads` items. Those are not pictures
  // or commands, so they keep their own rows and the lanes around them survive.
  it("leaves a merged reads item where it was", () => {
    const reads: Item = { t: "reads", id: "r1", tools: [] };
    const items = [
      call("b1", "bash", { args: JSON.stringify({ command: "a" }) }),
      call("b2", "bash", { args: JSON.stringify({ command: "b" }) }),
      reads,
      call("p1", "view_image", { images: ["data:image/png;base64,AA"] }),
      call("p2", "view_image", { images: ["data:image/png;base64,BB"] }),
    ];
    expect(lanes(items)).toEqual(["commands:b1,b2", "row:r1", "pictures:p1,p2"]);
  });
});
