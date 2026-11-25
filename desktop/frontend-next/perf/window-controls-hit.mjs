// The docked workbench's tab strip shares the window bar with the Windows
// window controls. Whether the buttons still own their presses once the strip
// moves onto the bar is a stacking and drag-region question — geometry and
// hit-testing, which jsdom cannot answer. src/styles/window-controls-hit.test.ts
// holds the rule's shape; this asks the browser.
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
try {
  for (const width of [1440, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.setDefaultTimeout(20000);
    page.on("pageerror", (e) => fails.push("page error: " + e.message));
    await page.goto(`${BASE}?pref=zh`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app");
    await page.evaluate(() => {
      document.documentElement.dataset.titlebar = "app";
      document.documentElement.dataset.platform = "windows";
    });
    await page.addStyleTag({ content: "*{transition:none!important;animation:none!important}" });
    // The controls read the platform at render: a state change mounts them on
    // the datasets just written, without waiting for the dock to open.
    await page.locator('[data-action="appearance.theme"]').first().click();
    await page.waitForTimeout(200);

    const probe = () =>
      page.evaluate(() => {
        const slot = document.querySelector(".wb-dock-head");
        const controls = document.querySelector(".winctl");
        if (!controls) return { missing: "the window controls are not drawn" };
        const slotBox = slot?.getBoundingClientRect();
        const strips = slot?.querySelector(".workbench-tabs") != null;
        const buttons = [...controls.querySelectorAll(".wc")].map((b) => {
          const r = b.getBoundingClientRect();
          const misses = [];
          for (const fx of [0.2, 0.5, 0.8]) {
            for (const fy of [0.3, 0.5, 0.7]) {
              const x = r.left + r.width * fx, y = r.top + r.height * fy;
              const hit = document.elementFromPoint(x, y);
              if (!hit || !b.contains(hit)) {
                misses.push(`${Math.round(x)},${Math.round(y)} -> ${hit ? hit.tagName.toLowerCase() + "." + [...hit.classList].join(".") : "nothing"}`);
              } else if (getComputedStyle(hit).webkitAppRegion === "drag") {
                misses.push(`${Math.round(x)},${Math.round(y)} is a drag region`);
              }
            }
          }
          return { label: b.getAttribute("aria-label"), right: Math.round(r.right), left: Math.round(r.left), misses };
        });
        return {
          dockedStrip: !!strips,
          slotRight: slotBox && strips ? Math.round(slotBox.right) : null,
          controlsLeft: Math.round(controls.getBoundingClientRect().left),
          buttons,
        };
      });

    for (const round of ["dock shut", "dock open"]) {
      if (round === "dock open") {
        await page.locator('[data-action="pane.view"][data-value="browser"]').first().click();
        await page.waitForTimeout(600);
      }
      const at = await probe();
      check(`${width} ${round}: the window controls are drawn`, !at.missing, at.missing ?? "");
      if (at.missing) continue;
      const missed = at.buttons.flatMap((b) => b.misses.map((m) => `${b.label} ${m}`));
      check(`${width} ${round}: every point on all three controls belongs to its button`, missed.length === 0, missed.slice(0, 4).join(" | "));
      if (at.dockedStrip) {
        check(`${width} ${round}: the strip's slot ends where the controls begin`, at.slotRight !== null && at.slotRight <= at.controlsLeft + 1, `slot ${at.slotRight} / controls ${at.controlsLeft}`);
      } else {
        check(`${width} ${round}: no strip in the bar, so the slot stays out of the way`, at.slotRight === null);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
if (fails.length) {
  console.error(`\n${fails.length} failed: ${fails.join("; ")}`);
  process.exit(1);
}
