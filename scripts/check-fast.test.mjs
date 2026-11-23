import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The script under test is the repository's own, run against this checkout with
// --print-plan: it reads git and the test files beside the changed ones, and
// prints what it would run without running it. Testing the real script this way
// keeps the assertions about the selection rule, not about a stub that copies it.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "check-fast.sh");

const plan = (...args) =>
  spawnSync("bash", [script, "--print-plan", ...args], { cwd: root, encoding: "utf8" });

test("the plan names the packages a change touched, not the whole module", () => {
  const r = plan("--base", "HEAD");
  assert.equal(r.status, 0, r.stderr);
  // Every line that runs tests is scoped to one package under internal/ or cmd/,
  // and no line asks for ./...
  for (const line of r.stdout.split("\n").filter((l) => l.includes("go test "))) {
    assert.doesNotMatch(line, /go test \.\/\.\.\./, line);
    assert.match(line, /go test \.\/(internal|cmd|sdk)\//, line);
  }
});

test("a narrowed run selects tests by the feature a file belongs to", () => {
  const r = plan("--base", "HEAD");
  assert.equal(r.status, 0, r.stderr);
  // The peer feature's files are changed in this checkout, so the names they
  // share with their test files appear; unrelated features do not.
  assert.match(r.stdout, /TestAMessageAtTheHopLimitIsNotSentAgain|TestNeverIsOneOfTheFourAnswers/);
});

test("an unknown argument is refused rather than ignored", () => {
  const r = spawnSync("bash", [script, "--nonsense"], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown argument/);
});
