import assert from "node:assert/strict";
import { test } from "node:test";
import { groupCommits, parseSubject } from "./notes-draft.mjs";

test("a scoped conventional subject splits into type, scope and subject", () => {
  assert.deepEqual(parseSubject("feat(studio): the new-session project picker"), {
    type: "feat",
    scope: "studio",
    subject: "the new-session project picker",
  });
});

test("a subject with no conventional prefix keeps its whole text and names no type", () => {
  assert.deepEqual(parseSubject("Merge branch 'x'"), { type: "", scope: "", subject: "Merge branch 'x'" });
});

test("a breaking marker still parses as its type", () => {
  assert.equal(parseSubject("fix(peers)!: drop the old release rule").type, "fix");
});

test("each conventional type lands in the group section 6 asks for", () => {
  const commits = [
    { sha: "1111111111", subject: "feat(studio): a new panel" },
    { sha: "2222222222", subject: "perf: read the tree once" },
    { sha: "3333333333", subject: "fix(serve): the grant follows the listener" },
    { sha: "4444444444", subject: "remove(studio): the market" },
    { sha: "5555555555", subject: "revert: put it back" },
  ];
  const { items, quiet } = groupCommits(commits);
  assert.deepEqual([...items.keys()], ["新增", "变更", "修复", "移除"]);
  assert.equal(items.get("新增").length, 1);
  assert.equal(items.get("变更").length, 1);
  assert.equal(items.get("修复").length, 2, "a revert reads as a fix, the way a reader sees it");
  assert.equal(items.get("移除").length, 1);
  assert.equal(quiet.length, 0);
});

test("types a user would not notice become a comment, never an item", () => {
  const commits = [
    { sha: "1111111111", subject: "chore(standards): back under budget" },
    { sha: "2222222222", subject: "docs(readme): describe the fork" },
    { sha: "3333333333", subject: "refactor(studio): split the window" },
    { sha: "4444444444", subject: "ci: pin macOS" },
    { sha: "5555555555", subject: "test: cover the picker" },
    { sha: "6666666666", subject: "build: bump the toolchain" },
    { sha: "7777777777", subject: "style: reflow" },
  ];
  const { items, quiet } = groupCommits(commits);
  assert.equal(items.size, 0);
  assert.equal(quiet.length, 7);
});

test("an unknown type is left out rather than guessed into a group", () => {
  const { items, quiet } = groupCommits([{ sha: "1111111111", subject: "wip: half a thought" }]);
  assert.equal(items.size, 0);
  assert.equal(quiet.length, 1);
});

test("a subject carrying a pipe keeps its text", () => {
  assert.equal(parseSubject("fix(serve): a|b reads as one subject").subject, "a|b reads as one subject");
});
