// Frame cost of folding the left rail with 1/3/6 panes across a TURNS axis (session length). The rail
// is an overlay: its column stays 0 and only the rail slides, so a toggle costs one style invalidation
// instead of re-laying out every mounted pane on each frame. The turns axis runs at PERF_TURN_CPU (the
// pane guard keeps PERF_CPU). Guard: the 150-turn p95 stays within PERF_TURN_RATIO of the 0-turn p95,
// the 400-turn p50Trim stays within the same ratio (400-turn p95/worst are reported, not gated), the
// 3-pane median stays within FRAME_RATIO_MAX of one pane, a hidden pane returns at the scroll position
// it left, and the transcript keeps its inherited column variables constant while the rail slides.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const CPU = Number(process.env.PERF_CPU ?? 4);
const TURN_CPU = Number(process.env.PERF_TURN_CPU ?? 1);
const TURNS = [...new Set((process.env.PERF_TURNS ?? "0,150,400").split(",").map(Number).filter(Number.isFinite))];
if (!TURNS.length) throw new Error("PERF_TURNS must list at least one turn count");
const REPS = Math.max(3, Number(process.env.PERF_REPS ?? 3));
const COUNTS = (process.env.PERF_N ?? "1,3,6").split(",").map(Number);
const GUARD = Number(process.env.PERF_GUARD ?? 3);
const FRAME_RATIO_MAX = Number(process.env.PERF_FRAME_RATIO ?? 2.5);
const TURN_RATIO_MAX = Number(process.env.PERF_TURN_RATIO ?? 2.0);
// A 150-turn toggle at 4x collapses to one frame, so the median would be the one-time reflow rather
// than the animation; that is what the turns axis samples at CPU=1. 400 turns reports p50Trim only:
// its p95 and worst are the single hitch, which is expected and must not gate.
const BASE_TURNS = Math.min(...TURNS);
const P95_TURNS = 150;
const TRIM_TURNS = 400;
const GUARD_SEED = 60;
const URL = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const SHOTS = process.env.RAIL_TOGGLE_SHOTS;
if (SHOTS) await mkdir(SHOTS, { recursive: true });
const pct = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
const pctTrim = (a, p) => {
  if (a.length < 2) return pct(a, p);
  const worst = a.indexOf(Math.max(...a));
  return pct([...a.slice(0, worst), ...a.slice(worst + 1)], p);
};
const browser = await chromium.launch();
const rows = [];
let kept = null;

async function seed(page, turns) {
  await page.evaluate(async (k) => {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    for (let i = 0; i < k; i++) {
      const id = `t${i}`, args = JSON.stringify({ command: `go test ./pkg${i}/...` });
      window.__feed({ kind: "turn_started" });
      window.__feed({ kind: "tool_dispatch", tool: { id, name: "bash", args } });
      window.__feed({ kind: "tool_result", tool: { id, name: "bash", args, output: "ok\n".repeat(20) } });
      window.__feed({ kind: "text", text: `第 ${i} 段回答。\n\n- 要点一\n- 要点二\n\n` });
      window.__feed({ kind: "message" });
      window.__feed({ kind: "turn_done" });
      if (i % 10 === 9) await frame();
    }
    await frame();
  }, turns);
}

for (const n of COUNTS) {
  for (const turns of TURNS) {
    const ctx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await page.goto(`${URL}?panes=${n}`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app");
    await page.waitForTimeout(800);
    await seed(page, turns);
    await page.waitForTimeout(800);
    if (TURN_CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: TURN_CPU });
    await cdp.send("Performance.enable");
    const metrics = async () =>
      Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
    const before = await metrics();
    const frames = [];
    let nodes = 0;
    for (let r = 0; r < REPS; r++) {
      const got = await page.evaluate(async () => {
        const out = [];
        let prev = performance.now();
        const end = prev + 450;
        const before = document.querySelector(".app")?.dataset.rail;
        const mac = /Mac/.test(navigator.platform);
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
        while (performance.now() < end) {
          await new Promise((res) => requestAnimationFrame(res));
          const now = performance.now();
          out.push(now - prev);
          prev = now;
        }
        if (document.querySelector(".app")?.dataset.rail === before) throw new Error("the rail did not toggle");
        return { frames: out, nodes: document.querySelectorAll("*").length };
      });
      frames.push(...got.frames);
      nodes = got.nodes;
      await page.waitForTimeout(150);
    }
    const after = await metrics();
    const delta = (k) => ((after[k] ?? 0) - (before[k] ?? 0)) * 1000;
    rows.push({
      panes: n,
      turns,
      toggles: REPS,
      "frames/toggle": (frames.length / REPS).toFixed(0),
      p50: pct(frames, 0.5).toFixed(1),
      p50Trim: pctTrim(frames, 0.5).toFixed(1),
      p95: pct(frames, 0.95).toFixed(1),
      worst: Math.max(...frames).toFixed(1),
      over50: frames.filter((f) => f > 50).length,
      "style/ms": delta("RecalcStyleDuration").toFixed(0),
      "layout/ms": delta("LayoutDuration").toFixed(0),
      nodes,
    });
    await ctx.close();
  }
}

if (COUNTS.includes(GUARD)) {
  const ctx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${URL}?panes=${GUARD}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".app");
  await page.waitForTimeout(800);
  await seed(page, GUARD_SEED);
  await page.waitForTimeout(800);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const first = page.locator('.sessrow[data-target="/sessions/pane-1.jsonl"]');
  const second = page.locator('.sessrow[data-target="/sessions/pane-2.jsonl"]');
  assert.equal(await first.getAttribute("data-live"), "", "the first row must identify an existing pane");
  assert.equal(await second.getAttribute("data-live"), "", "the second row must identify another existing pane");
  assert.equal(await first.getAttribute("aria-selected"), "true", "the measured pane must be the first session");
  const scroller = await page.locator('.pane:not([data-off]) .scroll[data-pane="flow"]').elementHandle();
  assert.ok(scroller);
  await scroller.evaluate((root) => { root.scrollTop = 400; });
  await page.waitForTimeout(200);
  assert.equal(await scroller.evaluate((root) => root.scrollTop), 400, "the initial reading position must be reachable");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/before-hidden.png` });
  await second.click();
  await page.waitForFunction(() => document.querySelector('.sessrow[data-target="/sessions/pane-2.jsonl"]')?.getAttribute("aria-selected") === "true");
  assert.ok(await scroller.evaluate((root) => root.closest(".pane").hasAttribute("data-off")), "the original pane must actually be hidden");
  assert.equal(await page.locator(".pane").count(), GUARD, "switching existing conversations must not open a new pane");
  await page.evaluate(() => {
    window.__feed({ kind: "turn_started" });
    window.__feed({ kind: "text", text: "Background scroll preservation probe." });
    window.__feed({ kind: "message" });
    window.__feed({ kind: "turn_done" });
  });
  await page.waitForFunction(() => document.querySelector(".pane:not([data-off]) .flow")?.textContent.includes("Background scroll preservation probe."));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/while-hidden.png` });
  await first.click();
  await page.waitForFunction(() => document.querySelector('.sessrow[data-target="/sessions/pane-1.jsonl"]')?.getAttribute("aria-selected") === "true");
  assert.ok(await scroller.evaluate((root) => root === document.querySelector('.pane:not([data-off]) .scroll[data-pane="flow"]')), "scroll-retention precondition: inspect the originally hidden transcript");
  kept = await scroller.evaluate((root) => root.scrollTop);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-return.png` });
  await second.click();
  await page.waitForFunction(() => {
    if (document.querySelector('.sessrow[data-target="/sessions/pane-2.jsonl"]')?.getAttribute("aria-selected") !== "true") return false;
    const root = document.querySelector('.pane:not([data-off]) .scroll[data-pane="flow"]');
    return root && root.scrollHeight - root.clientHeight - root.scrollTop <= 48;
  });
  console.log(`existing pane round trip: scrollTop 400 -> hidden with new output -> ${kept}; following neighbour remains at latest`);
  await ctx.close();
}

const inherited = await (async () => {
  const ctx = await browser.newContext({ locale: "zh-CN", viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${URL}?panes=1`, { waitUntil: "networkidle" });
  await page.waitForSelector(".flow");
  const seen = await page.evaluate(async () => {
    const read = () => ["--rail-w", "--nav-w", "--side-w"].map((v) => getComputedStyle(document.querySelector(".flow")).getPropertyValue(v)).join(" ");
    const rail = () => getComputedStyle(document.querySelector(".chrome")).getPropertyValue("--rail-w");
    const out = { flow: [read()], rail: [rail()] };
    const mac = /Mac/.test(navigator.platform);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
    for (const wait of [90, 400]) {
      await new Promise((r) => setTimeout(r, wait));
      out.flow.push(read());
      out.rail.push(rail());
    }
    return out;
  });
  await ctx.close();
  return seen;
})();
await browser.close();
console.table(rows);
const fails = [];
const one = rows.find((r) => r.panes === 1 && r.turns === BASE_TURNS);
const many = rows.find((r) => r.panes === GUARD && r.turns === BASE_TURNS);
if (one && many && Number(many.p50) > Number(one.p50) * FRAME_RATIO_MAX) {
  fails.push(`median frame with ${GUARD} panes is ${many.p50} ms against ${one.p50} ms with one (limit x${FRAME_RATIO_MAX})`);
}
for (const n of COUNTS) {
  const base = rows.find((r) => r.panes === n && r.turns === BASE_TURNS);
  if (!base) continue;
  const p95 = rows.find((r) => r.panes === n && r.turns === P95_TURNS);
  if (p95 && Number(p95.p95) > Number(base.p95) * TURN_RATIO_MAX) {
    fails.push(`p95 frame with ${n} panes at ${P95_TURNS} turns is ${p95.p95} ms against ${base.p95} ms at ${BASE_TURNS} (limit x${TURN_RATIO_MAX})`);
  }
  const trim = rows.find((r) => r.panes === n && r.turns === TRIM_TURNS);
  if (trim && Number(trim.p50Trim) > Number(base.p50Trim) * TURN_RATIO_MAX) {
    fails.push(`trimmed median frame with ${n} panes at ${TRIM_TURNS} turns is ${trim.p50Trim} ms against ${base.p50Trim} ms at ${BASE_TURNS} (limit x${TURN_RATIO_MAX})`);
  }
}
if (new Set(inherited.rail).size < 2) fails.push(`the rail width did not change during the fold (${inherited.rail.join(" -> ")}), so the guard measured nothing`);
else if (new Set(inherited.flow).size > 1) fails.push(`the transcript inherits the animated column widths (${inherited.flow.join(" -> ")}); every element under it is restyled on each frame of the fold`);
if (kept !== null && Math.abs(kept - 400) > 2) fails.push(`a pane hidden at scrollTop 400 came back at ${kept}`);
if (fails.length) {
  console.error(fails.join("\n"));
  process.exit(1);
}
