// 两侧栏：收起要看得见地收，宽度要拖得动。
//
// 补间这件事没有报错可言 —— grid-template-columns 那一列里放回一个 minmax()，
// 动画就静静地退成跳变，界面照样能用。所以它得有人量。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PERF_SRC ?? join(HERE, "..", "src");

// Read from the source that decides them. Copied here, these numbers described
// the rail until someone changed its default, and then they described nothing
// while still failing.
const span = (name) => {
  const src = readFileSync(join(SRC, "ui", "Gutter.tsx"), "utf8");
  const row = src.split(`export const ${name}: Span = {`)[1]?.split("}")[0] ?? "";
  const num = (key) => {
    const after = row.split(key + ":")[1];
    return after === undefined ? NaN : parseInt(after.trim(), 10);
  };
  return { def: num("def"), min: num("min"), max: num("max") };
};

const PAGE = process.env.PERF_URL ?? "http://localhost:4399/perf.html";
const RAIL = span("RAIL");
if (!Number.isFinite(RAIL.def)) {
  console.log("未能从 Gutter.tsx 读到栏宽定义：该检查将始终通过。");
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) fails.push(name);
};

page.on("pageerror", (e) => fails.push("页面异常: " + e.message));

await page.goto(`${PAGE}?ws=2&sess=6`, { waitUntil: "networkidle" });
await page.waitForSelector(".app", { timeout: 15000 });
await page.waitForTimeout(700);

const widthOf = (sel) => page.evaluate((s) => Math.round(document.querySelector(s).getBoundingClientRect().width), sel);
const railState = () => page.evaluate(() => document.querySelector(".app").dataset.rail);
const railRight = () => page.evaluate(() => Math.round(document.querySelector(".rail").getBoundingClientRect().right));
const fold = () => page.evaluate(() => {
  const mac = /Mac/.test(navigator.platform);
  dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
});

// 1) 轨道切换不再补间：内容列一次落位，面板自己滑出/滑入。
// 连采一段帧，分别看面板让出的那一列（main）和面板自己的右沿（rail）。
const sweep = () =>
  page.evaluate(async () => {
    const rail = document.querySelector(".rail");
    const main = document.querySelector(".main");
    const out = { rail: [], main: [] };
    const tick = () => {
      out.rail.push(rail.getBoundingClientRect().right);
      out.main.push(main.getBoundingClientRect().width);
    };
    tick();
    const mac = /Mac/.test(navigator.platform);
    dispatchEvent(new KeyboardEvent("keydown", { key: "b", ctrlKey: !mac, metaKey: mac, bubbles: true, cancelable: true }));
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      tick();
    }
    return out;
  });

const between = (values) => {
  const first = values[0], last = values[values.length - 1];
  return new Set(values.filter((v) => Math.abs(v - first) > 0.5 && Math.abs(v - last) > 0.5).map(Math.round));
};

// A collapsed column is out of the tab order, not only out of sight.
const railInert = () => page.evaluate(() => document.querySelector(".rail").inert);
const open = RAIL.def;
const shut = await sweep();
check(`收起 rail 是滑出的`, between(shut.rail).size >= 6, `${between(shut.rail).size} 个中间右沿`);
check(`收起 rail 时内容列不动`, between(shut.main).size === 0, `${between(shut.main).size} 个中间宽度`);
check(`收起 rail 收到底`, Math.round(shut.rail[shut.rail.length - 1]) === 0);
check(`收起 rail 后键盘够不着`, await railInert());

const back = await sweep();
check(`展开 rail 是滑入的`, between(back.rail).size >= 6, `${between(back.rail).size} 个中间右沿`);
check(`展开 rail 时内容列不动`, between(back.main).size === 0, `${between(back.main).size} 个中间宽度`);
check(`展开 rail 回到 ${open}`, Math.round(back.rail[back.rail.length - 1]) === open);
check(`展开 rail 后键盘够得着`, !(await railInert()));
await page.waitForTimeout(200);


// 2) 拖动改宽：跟着指针走，松手落在指针那里，且被记住。
const bar = await page.locator(".gutter-l").boundingBox();
check("左分隔条在场", !!bar);
await page.mouse.move(bar.x + bar.width / 2, bar.y + 300);
await page.mouse.down();
const trail = [];
for (const dx of [24, 56, 96]) {
  await page.mouse.move(bar.x + bar.width / 2 + dx, bar.y + 300);
  await page.waitForTimeout(60);
  trail.push(await widthOf(".rail"));
}
await page.mouse.up();
await page.waitForTimeout(200);
const dropped = await widthOf(".rail");
check("拖动跟手", trail[2] > trail[0], trail.join(" → "));
check("松手落在指针处", dropped === RAIL.def + 96, `${dropped}px`);
check("栏内内容跟着变宽", (await widthOf(".rail > *")) === dropped);
check(
  "宽度记在本地",
  (await page.evaluate(() => localStorage.getItem("rx-rail-w"))) === String(dropped),
);

// 3) 拖出来的宽度熬得过一次收起：展开回的是它，不是默认值。
await fold();
await page.waitForTimeout(450);
check("拖过之后仍收得干净", (await railRight()) === 0);
await fold();
await page.waitForTimeout(450);
check("展开回到拖出来的宽度", (await widthOf(".rail")) === dropped, `${await widthOf(".rail")} vs ${dropped}`);

// 4) 上限仍是尽头；下限不再是 —— 推穿那段阻尼，就是「关掉它」。这是收起最顺手
//    的入口，也是这一版把它从两个按钮手里拿回来的地方。
const b2 = await page.locator(".gutter-l").boundingBox();
const grab = b2.x + b2.width / 2;
await page.mouse.move(grab, b2.y + 300);
await page.mouse.down();
await page.mouse.move(grab + 900, b2.y + 300, { steps: 10 });
await page.waitForTimeout(80);
const high = await widthOf(".rail");
// 目标 20px 低于下限：已经越界，但还在 COMMIT 之前，所以停在 min。
const wantHeld = RAIL.min - 20;
await page.mouse.move(grab - (dropped - wantHeld), b2.y + 300, { steps: 10 });
await page.waitForTimeout(80);
const held = await widthOf(".rail");
await page.mouse.up();
await page.waitForTimeout(450);
check("拖不过上限", high === RAIL.max, `${high}px`);
check("越过下限但还在阻尼里：停住", held === RAIL.min, `${held}px`);

const b3 = await page.locator(".gutter-l").boundingBox();
await page.mouse.move(b3.x + b3.width / 2, b3.y + 300);
await page.mouse.down();
await page.mouse.move(b3.x - 400, b3.y + 300, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(450);
check("推穿阻尼即收起", (await railRight()) === 0 && (await railState()) === "off");

// 反向是同一个手势：从边上拖回来就展开。
const b4 = await page.locator(".gutter-l").boundingBox();
await page.mouse.move(b4.x + b4.width / 2, b4.y + 300);
await page.mouse.down();
await page.mouse.move(b4.x + 300, b4.y + 300, { steps: 14 });
await page.mouse.up();
await page.waitForTimeout(450);
check("反向拖回展开", (await railState()) === "on" && (await widthOf(".rail")) >= RAIL.min, `${await widthOf(".rail")}px`);

// 5) 键盘也能调；轨道不再补间，一步 12px 就直接落位。
await page.locator(".gutter-l").focus();
const beforeKey = await widthOf(".rail");
await page.keyboard.press("ArrowLeft");
await page.waitForTimeout(40);
check("方向键退一步", (await widthOf(".rail")) === beforeKey - 12, `${await widthOf(".rail")}px`);
await page.keyboard.press("Home");
await page.waitForTimeout(450);
check("Home 回默认", (await widthOf(".rail")) === RAIL.def, `${await widthOf(".rail")}px`);

// 6) Narrowed past room, the rail collapses to zero and its seam is the only
//    way back, so the seam stays; the page does not overflow sideways (#9507).
const shown = (sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return !!el && getComputedStyle(el).display !== "none";
}, sel);
for (const [w, keep] of [[1100, "左栏收起，把手留着"], [780, "左栏收起，把手留着"]]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.waitForTimeout(300);
  check(
    `窄到 ${w}px：${keep}`,
    (await shown(".gutter-l")) === true,
  );
  check(
    `窄到 ${w}px 不横向溢出`,
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  );
}

await browser.close();
console.log(fails.length ? `\n失败 ${fails.length} 项：\n- ${fails.join("\n- ")}` : "\n全部通过");
process.exit(fails.length ? 1 : 0);
