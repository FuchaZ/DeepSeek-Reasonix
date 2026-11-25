import { useEffect, useRef, useState } from "react";
import type { Tool } from "../port/wire";
import { t } from "../i18n";
import { seconds, tokens } from "../i18n/format";

// What a step cost, in the two units the kernel can state honestly per call:
// wall-clock, and what the call left in the prompt. The spec pairs them in that
// order wherever both are known ("1m04s · 9.5k"), so every card reads the same
// way and the slot never means one thing here and another there.
// 墙钟跨三个数量级 —— 一次读文件 0.2s，一条 bash 一分钟 —— 线性映射会把快的
// 那一批全挤成一个点。对数摊开它们，条只说长短，是什么类别由轨道那条线说。
function tookWidth(ms: number) {
  return 3 + Math.log10(1 + (ms / 1000) * 9) * 22;
}

// A wait that does not say how long it has been waiting reads the same at two
// seconds and at two minutes, which is what "看起来卡住了" is: the only thing
// moving on a running call is a 1.9s pulse on a 14px glyph, and a pulse is not
// a duration. The kernel's startedAt is deliberately not used — it is unix ms
// from the kernel's clock, and over a remote session that is not this window's,
// so counting from it would spend a clock skew as if it were elapsed time. This
// counts on the window's own clock from the moment the window saw the call
// running, and says nothing about a call that was already running when it
// arrived, because that is a duration this window does not know.

// The watch belongs to the call, not to the card drawing it: a session switch
// rebinds the pane through a new key, which unmounts the transcript and draws it
// again, and only the call's own id carries across that redraw.
const watching = new Map<string, { since: number; seen: number }>();
const WATCHED_CAP = 512;

function watchedSince(key: string): number {
  const at = Date.now();
  const held = watching.get(key);
  if (held) {
    held.seen = at;
    return held.since;
  }
  // Entries for calls whose card went away mid-call never reach the cleanup,
  // so past the cap the least recently watched half goes.
  if (watching.size >= WATCHED_CAP) {
    const byAge = [...watching].sort((a, b) => a[1].seen - b[1].seen);
    for (const [stale] of byAge.slice(0, WATCHED_CAP / 2)) watching.delete(stale);
  }
  watching.set(key, { since: at, seen: at });
  return at;
}

let anonymous = 0;

/** How long this window has watched the call run. The clock belongs to the
 *  window rather than the kernel — see above — and to the call rather than the
 *  card, so a redraw reads the count already recorded. */
export function useWatched(running: boolean, callId?: string): number {
  // A call the wire never named still gets a reading, on the card's own life
  // rather than the call's: nothing else would tell two unnamed calls apart.
  const anon = useRef("");
  if (!anon.current) anon.current = `card:${++anonymous}`;
  const key = running ? callId || anon.current : "";
  // Read during render, not in an effect: a redrawn card must say the length at
  // once, and starting at zero would be the restart this avoids.
  const from = useRef({ key: "", since: 0 });
  if (from.current.key !== key) from.current = { key, since: key ? watchedSince(key) : 0 };
  const since = from.current.since;
  const active = useRef("");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) {
      if (active.current) watching.delete(active.current);
      active.current = "";
      return;
    }
    active.current = key;
    // One second is the resolution a reader acts on; anything finer is a digit
    // changing for its own sake.
    const timer = setInterval(() => {
      if (key) watchedSince(key);
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [running, key]);
  // Under a second there is nothing to report: a call that answers that fast
  // never looked stuck, and a digit appearing and going is its own noise.
  const ms = since && now ? Math.max(0, now - since) : 0;
  return ms >= 1000 ? ms : 0;
}

export function Cost({ tools, running = false, callId }: { tools: Tool[]; running?: boolean; callId?: string }) {
  const ms = tools.reduce((n, t) => n + (t.durationMs ?? 0), 0);
  const left = tools.reduce((n, t) => n + (t.contextTokens ?? 0), 0);
  const live = useWatched(running, callId);
  if (!ms && !left && !live) return null;
  return (
    <span className="cost">
      {ms > 0 && <i className="took" style={{ width: `${tookWidth(ms).toFixed(1)}px` }} aria-hidden="true" />}
      {ms > 0 && <span>{seconds(ms)}</span>}
      {/* No bar while it runs. The bar is a length against a known duration;
          growing one against a duration nobody knows yet is a progress bar that
          cannot be honest about what fraction it has drawn. */}
      {!ms && live > 0 && <span className="live" title={t("composer.how_long_this_step_has")}>{seconds(live, 0)}</span>}
      {left > 0 && <span title={t("composer.estimated_tokens_this_step_leaves")}>{tokens(left)}</span>}
    </span>
  );
}
