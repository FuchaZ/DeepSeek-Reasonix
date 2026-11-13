// The rail replaces the sidebar's quicknav card, so the shape checks read the
// bar's rows now. Feedback is retired everywhere, so its row must be gone from
// the rail too.
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html?pref=zh&ws=1&sess=1&turns=1";
const TOLERANCE = 1;
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ locale: "zh-CN", colorScheme: scheme, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => { try { localStorage.setItem("rx-lang", "zh"); localStorage.setItem("rx-nav-rail", "on"); } catch {} });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.locator(".studio-collapse").click();
    // The rail stays mounted while parked behind the workspace column, so the
    // selector alone proves nothing: wait until it sits at the window edge.
    await page.waitForFunction(() => {
      const rail = document.querySelector(".nav");
      if (!rail || !rail.querySelector(".navbtn")) return false;
      const r = rail.getBoundingClientRect();
      return r.left >= 0 && r.right <= window.innerWidth;
    });
    const strip = await page.evaluate(() => [...document.querySelectorAll(".nav .navbtn")].map((b) => {
      const r = b.getBoundingClientRect();
      const iconEl = b.querySelector("svg, .studio-icon");
      const svg = iconEl ? iconEl.getBoundingClientRect() : null;
      return { w: r.width, h: r.height, left: r.left, cy: r.y + r.height / 2, icon: svg ? [svg.width, svg.height] : [0, 0], iconCy: svg ? svg.y + svg.height / 2 : r.y + r.height / 2 };
    }));
    const spread = (key) => Math.max(...strip.map((s) => s[key])) - Math.min(...strip.map((s) => s[key]));
    check(`${scheme}: the rail has several entries`, strip.length >= 5, `${strip.length}`);
    check(`${scheme}: the rail rows share one size`, spread("w") <= TOLERANCE && spread("h") <= TOLERANCE, JSON.stringify(strip.map((s) => [s.w, s.h])));
    check(`${scheme}: the rail rows align and center their icons`, spread("left") <= TOLERANCE && strip.every((s) => Math.abs(s.cy - s.iconCy) <= TOLERANCE), JSON.stringify(strip.map((s) => [s.left, s.cy - s.iconCy])));
    check(`${scheme}: the rail icons share one size`, new Set(strip.map((s) => s.icon.join("x"))).size === 1, strip.map((s) => s.icon.join("x")).join(" "));
    // A destination row has no stable data-action, so the three rows are found
    // by their zh label, the way nav-selection names them.
    const rows = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll(".nav .navbtn")];
      const named = ["新建会话", "搜索会话", "工具与权限"].map((prefix) => {
        const row = buttons.find((b) => (b.getAttribute("aria-label") ?? "").startsWith(prefix));
        if (!row) return null;
        const r = row.getBoundingClientRect();
        return { left: r.left, right: r.right, visible: r.width > 0 && r.height > 0 };
      });
      return named;
    });
    check(`${scheme}: new session, search and tools are drawn`, rows.every((r) => r?.visible), JSON.stringify(rows));
    check(`${scheme}: those rows share the rail's one column`, rows.every((r) => r && rows[0] && Math.abs(r.left - rows[0].left) <= TOLERANCE && Math.abs(r.right - rows[0].right) <= TOLERANCE), JSON.stringify(rows.map((r) => [r?.left, r?.right])));
    check(`${scheme}: the retired feedback row is not drawn`, !(await page.locator('.nav .navbtn[data-action="feedback.open"]').count()));
    await ctx.close();
  }
} finally {
  await browser.close();
}
if (fails.length) {
  console.error(`\n${fails.length} failed: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("\nall passed");
