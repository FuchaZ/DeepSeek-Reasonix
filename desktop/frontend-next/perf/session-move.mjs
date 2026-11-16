// A conversation moves one place up or down in its project's list with Alt+Arrow
// on the focused row — the right-click menu dropped its move items when it was
// slimmed to words that say what they open — and the new order is the kernel's
// (it is read again, not patched).
import { chromium } from "playwright";

const BASE = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const shotDir = process.env.SHOTS;
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  for (const width of [1280]) {
    const tag = `${scheme} ${width}px`;
    const page = await browser.newPage({ viewport: { width, height: 900 }, locale: "zh-CN", colorScheme: scheme, reducedMotion: "reduce" });
    page.on("pageerror", (e) => fails.push("页面异常: " + e.message));
    await page.goto(`${BASE}?pref=zh&ws=1&sess=4&turns=1`, { waitUntil: "networkidle" });
    await page.waitForSelector(".app");
    const rows = '.wsnode:has(> .wsrow[data-target="~/projects/workspace-0"]) .sessrow[role="treeitem"][data-target]';
    const remoteRows = '.sessrow-remote[role="treeitem"][data-target]';
    const order = () => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute("data-target")?.replace(/.*\/|\.jsonl/g, "")), rows);
    await page.waitForSelector(rows);
    const start = await order();
    const remoteOrder = () => page.locator(remoteRows).evaluateAll((els) => els.map((el) => el.dataset.target));
    const remoteStart = await remoteOrder();
    check(`${tag}: SSH conversations share the list`, remoteStart.length > 0, remoteStart.join());
    check(`${tag}: the project lists its four conversations`, start.length === 4, start.join());

    const first = page.locator(rows).first();
    await first.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await page.waitForFunction(([sel, s]) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute("data-target")?.replace(/.*\/|\.jsonl/g, "")).join() !== s, [rows, start.join()]);
    const moved = await order();
    check(`${tag}: moving it down puts it second, the rest keep their order`, moved.join() === [start[1], start[0], start[2], start[3]].join(), moved.join());

    await page.locator(rows).nth(1).focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.waitForFunction(([sel, s]) => [...document.querySelectorAll(sel)].map((e) => e.getAttribute("data-target")?.replace(/.*\/|\.jsonl/g, "")).join() === s, [rows, start.join()]);
    check(`${tag}: Alt+Up on the focused row puts it back first`, (await order()).join() === start.join());
    check(`${tag}: sorting local conversations preserves the SSH rows`, JSON.stringify(await remoteOrder()) === JSON.stringify(remoteStart));
    check(`${tag}: sorting keeps focus on the moved row`, await page.locator(rows).first().evaluate((el) => el === document.activeElement));
    await page.mouse.move(width - 3, 895);
    if (shotDir) await page.locator(".rail").screenshot({ path: `${shotDir}/${scheme}-rail.png` });
    await page.close();
  }
}
await browser.close();
if (fails.length) {
  console.error(`\n${fails.length} failed: ${fails.join("; ")}`);
  process.exit(1);
}
console.log("\nall passed");
