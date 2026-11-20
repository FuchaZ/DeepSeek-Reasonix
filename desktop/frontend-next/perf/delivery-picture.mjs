// A picture a reply presents is the answer, so the delivery card draws it above
// the file row at the width the card has, opens it in the shared viewer, and
// keeps the row's own name, open action and menu. A file that is not a picture,
// or one whose bytes do not load, keeps the row it always had.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const base = process.env.PERF_URL ?? "http://127.0.0.1:4399/perf.html?pref=zh";
const shots = process.env.DELIVERY_PICTURE_SHOTS;
if (shots) await mkdir(shots, { recursive: true });

const svg = (w, h, tint) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${tint}"/></svg>`;
const tall = svg(700, 1400, "#f5e6c8");
const wide = svg(1800, 500, "#c8e0f5");
const small = svg(64, 48, "#d8f5c8");

const browser = await chromium.launch();
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};
try {
  for (const scheme of ["light", "dark"]) {
    for (const width of [1440, 520]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, colorScheme: scheme });
      page.on("pageerror", (e) => fails.push(`${scheme} ${width}px page error: ${e.message}`));
      await page.route("**/fixture/**", (route) => {
        const url = route.request().url();
        const body = url.includes("tall") ? tall : url.includes("wide") ? wide : url.includes("broken") ? "not an image" : small;
        return route.fulfill({ contentType: "image/svg+xml", body });
      });
      await page.goto(base, { waitUntil: "networkidle" });
      await page.waitForFunction(() => window.__panes?.() > 0);
      await page.evaluate(() => {
        window.__feed({ kind: "turn_started", authoredTurn: 1, msgIndex: 0, text: "Present the screenshots" });
        window.__feed({ kind: "tool_dispatch", tool: { id: "present", name: "present_files", readOnly: true } });
        window.__feed({
          kind: "tool_result",
          tool: {
            id: "present", name: "present_files", readOnly: true, output: "Presented files",
            deliveries: [
              { path: "shots/tall.png", description: "PNG" },
              { path: "shots/wide.png", description: "PNG" },
              { path: "shots/broken.png", description: "PNG" },
              { path: "report.md", description: "Report" },
            ],
          },
        });
        window.__feed({ kind: "text", text: "Here they are." });
        window.__feed({ kind: "turn_done" });
      });
      await page.locator(".delivery-picture img").first().waitFor();
      await page.waitForTimeout(300);
      const tag = `${scheme} ${width}px`;
      const rows = await page.evaluate(() => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const cards = [...document.querySelectorAll(".delivery-file")];
        return cards.map((card) => {
          const picture = card.querySelector(".delivery-picture");
          const img = card.querySelector(".delivery-picture img");
          const open = card.querySelector(".delivery-open");
          return {
            name: card.querySelector(".delivery-name")?.textContent,
            picture: picture ? box(picture) : null,
            img: img ? box(img) : null,
            open: open ? box(open) : null,
            natural: img?.naturalWidth ?? 0,
          };
        });
      });
      const drawn = rows.filter((r) => r.picture);
      check(`${tag}: only the presentable pictures are drawn`, drawn.length === 2, JSON.stringify(rows.map((r) => r.name)));
      check(`${tag}: every picture keeps its own shape inside a bounded box`,
        drawn.every((r) => r.img.w > 0 && r.img.h > 0 && r.img.w <= r.picture.w + 1 && r.img.h <= 261),
        JSON.stringify(drawn.map((r) => [Math.round(r.img.w), Math.round(r.img.h)])));
      check(`${tag}: a tall picture is capped by height, a wide one by the card`,
        drawn[0].img.h <= 261 && drawn[0].img.w < drawn[0].picture.w && drawn[1].img.w > drawn[1].img.h,
        JSON.stringify(drawn.map((r) => [Math.round(r.img.w), Math.round(r.img.h)])));
      check(`${tag}: a picture never covers the file's own row`,
        drawn.every((r) => r.picture.b <= r.open.t + 1));
      check(`${tag}: a picture stays inside the card`,
        drawn.every((r) => r.picture.l >= 0 && r.picture.r <= width + 1));
      if (shots) await page.screenshot({ path: join(shots, `delivery-picture-${scheme}-${width}.png`), fullPage: false });

      // The picture opens the shared viewer, and the row below still opens the file itself.
      await page.locator(".delivery-picture").first().click();
      const dialog = page.getByRole("dialog", { name: "tall.png", exact: true });
      await dialog.waitFor();
      check(`${tag}: the picture opens in the shared viewer`, await dialog.locator("img").getAttribute("src") === "/fixture/shots/tall.png");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.locator(".delivery-open").filter({ hasText: "tall" }).click();
      const tab = page.locator('[role="tab"]').filter({ hasText: "tall.png" }).first();
      await tab.waitFor();
      check(`${tag}: the row still opens its file`, (await tab.getAttribute("aria-selected")) === "true");
      await page.close();
    }
  }
} finally {
  await browser.close();
}
if (fails.length) {
  console.log(`\n${fails.length} failed`);
  process.exit(1);
}
console.log("\nall ok");
