import { useEffect, useRef, useState } from "react";
import { useShown } from "./shown";

// Providers deliver several tokens per flush, so drawing each arrival turns the
// wire's bursts into a gush-then-crawl. The reveal paces itself by the measured
// arrival rate instead, holding at most BACKLOG_MS of text before catching up.
const RATE_WINDOW_MS = 1200;
const MIN_SPAN_MS = 60;
const BACKLOG_MS = 400;
const BACKLOG_MIN = 120;
const CATCHUP_MS = 120;
// With no measured rate yet, a burst is spread over this horizon rather than
// handed out in one frame.
const COLD_MS = 250;

export interface Arrival {
  t: number;
  n: number;
}

/** Characters per millisecond across the recorded arrivals; 0 when the record
 *  cannot answer — too few marks, a span too short to time, or one old enough
 *  that its rate says nothing about the stream in front of us. */
export function arrivalRate(marks: readonly Arrival[]): number {
  if (marks.length < 2) return 0;
  const first = marks[0];
  const last = marks[marks.length - 1];
  const span = last.t - first.t;
  if (span < MIN_SPAN_MS || span > RATE_WINDOW_MS) return 0;
  return Math.max(0, (last.n - first.n) / span);
}

/** Characters this frame may reveal: the measured pace, or a cold-start
 *  spread when there is none; everything past the held-back budget is caught
 *  up over CATCHUP_MS. Always at least one character while any are owed. */
export function revealStep(backlog: number, rate: number, dtMs: number): number {
  if (backlog <= 0) return 0;
  const steady = rate > 0
    ? Math.max(1, Math.floor(rate * dtMs))
    : Math.max(1, Math.ceil((backlog * dtMs) / COLD_MS));
  const held = Math.max(BACKLOG_MIN, rate * BACKLOG_MS);
  if (backlog <= held) return Math.min(steady, backlog);
  return Math.min(backlog, steady + Math.ceil(((backlog - held) * dtMs) / CATCHUP_MS));
}

export function useRevealed(text: string, streaming?: boolean): string {
  const watched = useShown();
  const [shown, setShown] = useState(text.length);
  const at = useRef(text.length);
  const want = useRef(text.length);
  const marks = useRef<Arrival[]>([]);
  const frameAt = useRef(0);
  want.current = text.length;

  useEffect(() => {
    const target = want.current;
    const now = performance.now();
    // A settled message, a reload or a new turn has no backlog to pace, and a
    // pane nobody is watching has no one to animate for.
    if (!streaming || !watched || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      at.current = target;
      setShown(target);
      marks.current = [];
      frameAt.current = 0;
      return;
    }
    // Replaced rather than appended (session switch, history restore): the
    // cursor has to come back with the text, or every later growth below the
    // old length is short-circuited below and the reveal never animates again.
    if (at.current > target) {
      at.current = target;
      setShown(target);
      marks.current = [];
    }
    const last = marks.current[marks.current.length - 1];
    if (!last || last.n !== target) {
      marks.current.push({ t: now, n: target });
      const floor = now - RATE_WINDOW_MS;
      while (marks.current.length > 2 && marks.current[0].t < floor) marks.current.shift();
    }
    if (at.current >= target) return;
    frameAt.current = now;
    let raf = 0;
    const step = (ts: number) => {
      const goal = want.current;
      if (at.current >= goal) return;
      const dt = Math.min(Math.max(ts - frameAt.current, 1), 100);
      frameAt.current = ts;
      at.current = Math.min(goal, at.current + revealStep(goal - at.current, arrivalRate(marks.current), dt));
      setShown(at.current);
      if (at.current < goal) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [streaming, watched, text.length]);

  return streaming && watched ? text.slice(0, shown) : text;
}
