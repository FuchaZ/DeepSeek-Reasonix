import { describe, expect, it } from "vitest";
import { arrivalRate, revealStep, type Arrival } from "./reveal";

const FRAME_MS = 16;
const BURST_MS = 240;
const BURST_CHARS = 96;

function run(ms: number) {
  const marks: Arrival[] = [{ t: 0, n: 0 }];
  let arrived = 0;
  let shown = 0;
  const steps: number[] = [];
  for (let t = FRAME_MS; t <= ms; t += FRAME_MS) {
    if (t % BURST_MS === 0) {
      arrived += BURST_CHARS;
      marks.push({ t, n: arrived });
      while (marks.length > 2 && marks[0].t < t - 1200) marks.shift();
    }
    const step = revealStep(arrived - shown, arrivalRate(marks), FRAME_MS);
    shown += step;
    steps.push(step);
  }
  return { arrived, shown, steps };
}

describe("the stream's pace", () => {
  it("is measured from the arrivals, not from the batch that just landed", () => {
    const marks: Arrival[] = [{ t: 0, n: 0 }, { t: 200, n: 40 }, { t: 400, n: 80 }];
    expect(arrivalRate(marks)).toBeCloseTo(0.2);
  });

  it("refuses a span too short to time, or one too old to describe this stream", () => {
    expect(arrivalRate([{ t: 0, n: 0 }, { t: 8, n: 20 }])).toBe(0);
    expect(arrivalRate([{ t: 0, n: 0 }, { t: 5000, n: 100 }])).toBe(0);
    expect(arrivalRate([{ t: 0, n: 0 }])).toBe(0);
  });

  it("hands a burst out at the arriving pace, never as one gulp", () => {
    const { steps } = run(2500);
    expect(Math.max(...steps)).toBeLessThanOrEqual(12);
  });

  it("keeps the visible text within the held-back budget", () => {
    const { arrived, shown } = run(2500);
    expect(arrived - shown).toBeLessThanOrEqual(200);
    expect(arrived - shown).toBeGreaterThan(0);
  });

  it("catches a backlog past the budget up without dropping it", () => {
    let backlog = 3000;
    let frames = 0;
    while (backlog > 120 && frames < 120) {
      backlog -= revealStep(backlog, 0.2, FRAME_MS);
      frames++;
    }
    expect(backlog).toBeLessThanOrEqual(120);
    expect(frames * FRAME_MS).toBeLessThan(700);
  });

  it("shows the first character on the first frame", () => {
    expect(revealStep(1, 0, FRAME_MS)).toBe(1);
    expect(revealStep(0, 0.4, FRAME_MS)).toBe(0);
  });
});
