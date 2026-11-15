// The chrome's folder mark sits at the window's left end only while the
// workspace column is shut, beside two fixed layers that own that corner.
// A control painted under them loses its press. Browser question: geometry,
// stacking and drag-region membership, which jsdom cannot answer.
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("rx-nav-rail", "collapsed"));
  await page.goto(`${BASE}?pref=zh`, { waitUntil: "networkidle" });
  await page.waitForSelector(".chrome .crumb-folder");
  await page.evaluate(() => {
    document.documentElement.dataset.titlebar = "app";
    document.documentElement.dataset.platform = "windows";
  });
  await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
  await page.evaluate(() => document.querySelector(".studio-collapse")?.click());
  await page.waitForTimeout(250);
  for (const rail of ["off", "on"]) {
    if (rail === "on") {
      await page.evaluate(() => document.querySelector(".studio-menu")?.click());
      await page.waitForTimeout(250);
    }
    const at = await page.evaluate(() => {
      const folder = document.querySelector(".chrome .crumb-folder");
      const crumb = document.querySelector(".chrome .crumb-context");
      const nav = document.querySelector(".nav");
      const menu = document.querySelector(".studio-menu");
      const r = folder.getBoundingClientRect();
      const z = (el) => el ? Number(getComputedStyle(el).zIndex) || 0 : 0;
      const samples = [];
      for (let dx = 1; dx < r.width; dx += 2) {
        for (const fy of [0.25, 0.5, 0.75]) {
          const hit = document.elementFromPoint(r.left + dx, r.top + r.height * fy);
          samples.push(!!hit && folder.contains(hit));
        }
      }
      return {
        rail: document.querySelector(".app").dataset.rail,
        rect: { x: Math.round(r.x), w: Math.round(r.width) },
        reached: samples.every(Boolean),
        crumbZ: z(crumb), navZ: z(nav), menuZ: z(menu),
        folderZ: z(folder),
        region: getComputedStyle(folder).webkitAppRegion,
        crumbRegion: getComputedStyle(crumb).webkitAppRegion,
      };
    });
    check(`${rail}: every point on the folder mark belongs to the button`, at.reached, JSON.stringify(at.rect));
    check(`${rail}: the crumb outranks the fixed corner layers`, at.crumbZ > at.navZ && at.crumbZ > at.menuZ, JSON.stringify({ crumb: at.crumbZ, nav: at.navZ, menu: at.menuZ }));
    check(`${rail}: the mark is out of the drag region while the crumb stays draggable`, at.region === "no-drag" && at.crumbRegion === "drag", `${at.region}/${at.crumbRegion}`);
  }
  await page.close();
} finally {
  await browser.close();
}
if (fails.length) {
  console.error(`\n${fails.length} failed: ${fails.join("; ")}`);
  process.exit(1);
}
