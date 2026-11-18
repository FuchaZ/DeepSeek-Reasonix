import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Plan } from "./Plan";
import type { PlanStep } from "../state/session";

const steps = (...done: boolean[]): PlanStep[] =>
  done.map((d, i) => ({
    text: `第 ${i + 1} 步`,
    status: d ? "completed" : i === done.indexOf(false) ? "in_progress" : "pending",
  }));

describe("the plan block", () => {
  // No plan and an empty plan are the same absence. A block reading "0 / 0 ·
  // 尚未制定" is a wall to skip on every glance at a rail that already has nine.
  it("draws nothing when there is no plan", () => {
    expect(renderToStaticMarkup(<Plan steps={[]} />)).toBe("");
  });

  it("counts what is done against what there is", () => {
    const html = renderToStaticMarkup(<Plan steps={steps(true, true, false, false)} />);
    expect(html).toContain('data-b="plan"');
    expect(html).toContain("2 / 4");
    expect(html).toContain("width:50%");
  });

  it("marks exactly one step as the one happening now", () => {
    const html = renderToStaticMarkup(<Plan steps={steps(true, false, false)} />);
    expect(html.match(/data-now=""/g)).toHaveLength(1);
    expect(html.match(/data-done=""/g)).toHaveLength(1);
  });

  // Every step done means nothing is happening now — not that the last one is.
  it("points at no step once they are all done", () => {
    expect(renderToStaticMarkup(<Plan steps={steps(true, true)} />)).not.toContain('data-now');
  });

  it("points at no step while the host has started none", () => {
    const written: PlanStep[] = [
      { text: "一", status: "pending" },
      { text: "二", status: "pending" },
    ];
    expect(renderToStaticMarkup(<Plan steps={written} />)).not.toContain("data-now");
  });

  it("points where the host points, not at the first unticked step", () => {
    const skipped: PlanStep[] = [
      { text: "一", status: "pending" },
      { text: "二", status: "in_progress", activeForm: "正在做第二步" },
      { text: "三", status: "pending" },
    ];
    const rows = renderToStaticMarkup(<Plan steps={skipped} />).split('class="s"').slice(1);
    expect(rows.map((r) => r.includes('data-now=""'))).toEqual([false, true, false]);
    expect(rows[1]).toContain("正在做第二步");
  });

  it("uses the step's own text once it is no longer the one underway", () => {
    const settled: PlanStep[] = [{ text: "写测试", status: "completed", activeForm: "正在写测试" }];
    const html = renderToStaticMarkup(<Plan steps={settled} />);
    expect(html).toContain("写测试");
    expect(html).not.toContain("正在写测试");
  });

  it("indents a sub-step by its level", () => {
    const nested: PlanStep[] = [
      { text: "父", status: "in_progress" },
      { text: "子", status: "pending", level: 1 },
    ];
    expect(renderToStaticMarkup(<Plan steps={nested} />)).toContain("margin-inline-start:12px");
  });

  // A phase and its sub-steps are two kinds of row. Indenting is the only thing
  // that told them apart, which read as "not aligned" rather than as depth; the
  // row now says which it is, so the mark can be drawn as the sub-step it is.
  it("says on the row whether it is a phase or a sub-step", () => {
    const nested: PlanStep[] = [
      { text: "阶段", status: "in_progress", level: 0 },
      { text: "子一", status: "pending", level: 1 },
      { text: "子二", status: "pending", level: 1 },
    ];
    const html = renderToStaticMarkup(<Plan steps={nested} />);
    expect(html.match(/data-level="0"/g)).toHaveLength(1);
    expect(html.match(/data-level="1"/g)).toHaveLength(2);
  });

  // todo_write rewrites the whole list every call, so two steps with the same
  // words must still be two rows rather than one React key collision.
  it("keeps duplicate steps apart", () => {
    const same: PlanStep[] = [{ text: "跑测试", status: "completed" }, { text: "跑测试", status: "in_progress" }];
    expect(renderToStaticMarkup(<Plan steps={same} />).match(/class="s"/g)).toHaveLength(2);
  });
});

describe("the two depths are drawn as two kinds of mark", () => {
  const sheet = (): string => {
    const raw = import.meta.glob("../design/plan.css", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    return Object.values(raw)[0];
  };

  it("sizes a sub-step's mark down and drops its ring", () => {
    const css = sheet();
    // A phase keeps the ring; a sub-step is progress inside one, so it reads as
    // a smaller, borderless mark instead of a second step of the plan.
    expect(css).toMatch(/\.plan-step\[data-level="1"\][^{]*\{[^}]*border:\s*0/);
    expect(css).toMatch(/\.plan-step\[data-level="1"\][^{]*\{[^}]*width:\s*14px/);
  });

  it("keeps the rail's own reading at its two sizes", () => {
    const css = sheet();
    expect(css).toMatch(/\.plan \.s\[data-level="1"\][^{]*\{[^}]*width:\s*8px/);
  });
});
