// The quicknav card is retired; the rail's rows and their hidden hint spans are
// the family this guard watches. The pointer rests off the bar while reading,
// because hover repaints a row and would split the at-rest family.
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html?pref=zh&ws=3&sess=3&turns=2";
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ locale: "zh-CN", colorScheme: scheme, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    await ctx.addInitScript(() => { try { localStorage.setItem("rx-nav-rail", "on"); } catch {} });
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
    await page.mouse.move(1270, 890);
    await page.waitForTimeout(300);
    // The current row wears the accent wash by design; the at-rest family is the rest.
    const looks = await page.evaluate(() => [...document.querySelectorAll(".nav .navbtn:not([aria-current])")].map((b) => {
      const c = getComputedStyle(b);
      const hint = b.querySelector(".navhint");
      const h = hint ? getComputedStyle(hint) : null;
      return {
        row: `${c.color} / ${c.backgroundColor} / ${c.fontSize}`,
        hint: h ? `${h.fontWeight} ${h.fontSize} ${h.fontFamily} / ${h.color}` : "missing hint",
      };
    }));
    const rows = new Set(looks.map((l) => l.row));
    check(`${scheme}: the rail rows share one ink and fill at rest`, rows.size === 1, [...rows].join(" | "));
    const hints = new Set(looks.map((l) => l.hint));
    check(`${scheme}: the rows' hidden hints share one typography`, hints.size === 1, [...hints].join(" | "));
    const gap = await page.evaluate(() => {
      const pick = (action) => [...document.querySelectorAll(".nav .navbtn")].find((b) => b.getAttribute("data-action") === action);
      const task = pick("session.new");
      const search = pick("workspace.search");
      if (!task || !search) return null;
      const a = task.getBoundingClientRect(), b = search.getBoundingClientRect();
      return b.y - (a.y + a.height);
    });
    check(`${scheme}: the search row follows the new-session row without a blank band`, gap !== null && gap >= 0 && gap <= 10, gap === null ? "row missing" : `${gap.toFixed(1)}px`);
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
