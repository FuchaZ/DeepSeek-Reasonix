import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";

const serial = process.argv[2];
assert(serial, "Usage: node android/scripts/verify-back.mjs <adb-serial> [package]");
const pkg = process.argv[3] || "io.reasonix.mobile.app.debug";
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const binary = process.platform === "win32" ? "adb.exe" : "adb";
const adb = sdk ? path.join(sdk, "platform-tools", binary) : binary;
const run = (...args) => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8", timeout: 15000 });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const foreground = () =>
  run("shell", "dumpsys", "activity", "activities")
    .split("\n")
    .some((line) => line.includes("topResumedActivity") && line.includes(pkg) && line.includes("MainActivity"));

assert(foreground(), "Unlock the phone and open Reasonix first");
const pid = run("shell", "pidof", pkg).trim();
const port = run("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`).trim();
let ws;
try {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
  const target = targets.find((entry) => entry.title === "Reasonix Studio");
  assert(target, "Reasonix Studio WebView is unavailable");
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const pending = new Map();
  let id = 0;
  ws.addEventListener("message", (event) => {
    const reply = JSON.parse(event.data);
    if (reply.id) pending.get(reply.id)?.(reply);
  });
  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const request = ++id;
      const timer = setTimeout(() => {
        pending.delete(request);
        reject(new Error(`${method} timed out`));
      }, 8000);
      pending.set(request, (reply) => {
        clearTimeout(timer);
        pending.delete(request);
        if (reply.error || reply.result?.exceptionDetails) reject(new Error(`${method} failed`));
        else resolve(reply.result);
      });
      ws.send(JSON.stringify({ id: request, method, params }));
    });
  const evaluate = async (expression) =>
    (await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async (expression, what) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate(expression)) return;
      await pause(100);
    }
    assert.fail(what);
  };

  assert(
    await evaluate(`(() => {
      const settings = document.querySelector('[data-action="chrome.settings"]');
      if (!settings) return false;
      settings.click();
      return true;
    })()`),
    "The settings entry is unavailable",
  );
  await waitFor("!!document.querySelector('.prefs')", "Settings did not open");
  run("shell", "input", "keyevent", "4");
  await waitFor("!document.querySelector('.prefs')", "System back did not close Settings");
  assert(foreground(), "System back left the app from Settings");

  assert(
    await evaluate(`(() => {
      const more = document.querySelector('.chrome .thbtn.r-more');
      if (!more) return false;
      more.click();
      return true;
    })()`),
    "Open Reasonix in portrait first: the gathered menu is not in this fold",
  );
  await waitFor("!!document.querySelector('.chrome .r-fold[data-open]')", "The gathered menu did not open");
  run("shell", "input", "keyevent", "4");
  await waitFor("!document.querySelector('.chrome .r-fold[data-open]')", "System back did not close the gathered menu");
  assert(foreground(), "System back left the app from the gathered menu");
  assert(!(await evaluate("!!document.querySelector('.prefs')")), "Settings reopened after the second press");
  console.log(JSON.stringify({ result: "passed" }));
} finally {
  ws?.close();
  run("forward", "--remove", `tcp:${port}`);
}
