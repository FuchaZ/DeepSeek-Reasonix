import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const browser = await chromium.launch();
try {
  await mkdir("perf/shots", { recursive: true });
  for (const colorScheme of ["light", "dark"]) for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("rx-nav-rail", "off");
      localStorage.setItem("rx-lang", "zh");
    });
    await page.goto(`${base}?pref=zh&turns=1`, { waitUntil: "networkidle" });
    if (width === 390) await page.locator('.studio-menu').click();
    // The column's foot is the settings row and nothing else: the destinations
    // live in the column's own rows, and the hover card that once folded them
    // behind a chevron is retired — no menu, no toggle, no feedback row.
    const root = page.locator(".studio-tools");
    const settings = root.locator('[data-action="chrome.settings"]');
    assert.equal(await settings.innerText(), "设置");
    assert.equal(await page.locator('.studio-feedback').count(), 0, 'the retired feedback row is not drawn');
    assert.equal(await page.locator('.studio-tools-toggle').count(), 0, 'the retired chevron toggle is not drawn');
    assert.equal(await page.getByRole('menu', { name: '侧栏入口' }).count(), 0, 'the retired hover card is not drawn');
    await page.screenshot({ path: `perf/shots/sidebar-tools-${colorScheme}-${width}.png` });
    await settings.click();
    await page.locator('.prefs-screen').waitFor();
    assert.equal(await page.getByRole('menu', { name: '侧栏入口' }).count(), 0, 'no card rides along to the settings page');
    assert.deepEqual(errors, []);
    console.log(`PASS sidebar ${colorScheme} ${width}px: the settings row alone, retired rows absent`);
    await page.close();
  }
} finally {
  await browser.close();
}
