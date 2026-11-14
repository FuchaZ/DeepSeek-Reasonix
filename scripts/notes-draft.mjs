#!/usr/bin/env node
// Writes the skeleton of release-notes/studio/<version>.md from the commits since
// the previous studio-v* tag. It never edits an existing file: a version that
// already has notes is refused, so the runbook's draft step cannot overwrite a
// hand-edited note. Every emitted item carries the commit that earned it, which
// is what release-note R4 asks for.
//
//   notes-draft.mjs <version> [--from <ref>] [--stdout]
//
// Grouping follows section 6 of docs/STUDIO_RELEASE.md. A type that no user
// would notice (chore, docs, refactor, ci, test) is listed as a comment rather
// than an item, so the person writing the note sees what was left out instead of
// having to read git log again.

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");

// The order of these groups is the order section 6 requires in the document.
const GROUPS = [
  { heading: "新增", english: "New", types: ["feat"] },
  { heading: "变更", english: "Changed", types: ["change", "perf"] },
  { heading: "修复", english: "Fixed", types: ["fix", "revert"] },
  { heading: "移除", english: "Removed", types: ["remove"] },
];
const UPGRADE = { heading: "升级须知", english: "Upgrade notes", types: [] };
// Types whose commits are context for the writer, never an item of their own.
const QUIET = new Set(["chore", "docs", "refactor", "ci", "test", "build", "style"]);

const ENGLISH_MARK = "<!-- lang:en -->";

export function parseArgs(argv) {
  const out = { version: "", from: "", stdout: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--stdout") out.stdout = true;
    else if (a === "--from") out.from = argv[++i] ?? "";
    else if (!a.startsWith("-") && !out.version) out.version = a;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!out.version) throw new Error("usage: notes-draft.mjs <version> [--from <ref>] [--stdout]");
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(out.version)) {
    throw new Error(`version ${out.version} is not semver without a leading v`);
  }
  return out;
}

// "feat(studio): the new-session project picker" -> { type, scope, subject }
export function parseSubject(subject) {
  const m = /^([a-z]+)(?:\(([^)]*)\))?!?:\s*(.+)$/.exec(subject);
  if (!m) return { type: "", scope: "", subject };
  return { type: m[1], scope: m[2] ?? "", subject: m[3] };
}

export function groupCommits(commits) {
  const items = new Map();
  const quiet = [];
  for (const c of commits) {
    const p = parseSubject(c.subject);
    if (QUIET.has(p.type)) {
      quiet.push(c);
      continue;
    }
    const g = GROUPS.find((x) => x.types.includes(p.type));
    if (!g) {
      quiet.push(c);
      continue;
    }
    if (!items.has(g.heading)) items.set(g.heading, []);
    items.get(g.heading).push({ ...c, ...p });
  }
  return { items, quiet };
}

function render({ version, commits, items, quiet, previous }) {
  const short = (sha) => sha.slice(0, 9);
  const lines = [];

  // R1: one sentence, no other paragraph before the groups.
  lines.push(`本版${items.size ? "见下" : "尚未填写摘要"}。`, "");

  const used = [];
  for (const g of GROUPS) {
    const got = items.get(g.heading);
    if (!got) continue;
    lines.push(`## ${g.heading}`, "");
    for (const c of got) {
      lines.push(`- TODO: 描述用户能观察到什么（${short(c.sha)}）— ${c.subject}`);
      used.push(c);
    }
    lines.push("");
  }

  // 升级须知 carries no item of its own: nobody can tell from a commit whether an
  // upgrade needs a note, so the section ships as a comment for the writer to
  // replace or delete. A TODO list item here would fail release-note R4, which
  // asks every change to name its commit.
  lines.push(`<!--${UPGRADE.heading}: delete this section, or state what an upgrade needs to know.-->`);
  lines.push("");
  lines.push("---", "", ENGLISH_MARK, "");

  lines.push(`This revision ${items.size ? "changes the following" : "has no items yet"}.`, "");
  for (const g of GROUPS) {
    const got = items.get(g.heading);
    if (!got) continue;
    lines.push(`## ${g.english}`, "");
    for (const c of got) lines.push(`- TODO: what the user observes (${short(c.sha)}) — ${c.subject}`);
    lines.push("");
  }
  lines.push(`<!--${UPGRADE.english}: delete this section, or state what an upgrade needs to know.-->`, "");

  if (quiet.length) {
    // One line, so the prose checker never folds it into a paragraph: it skips a
    // line that opens with an HTML tag and nothing else continues the block.
    lines.push(
      `<!--${quiet.length} commit(s) since ${previous || "the first commit"} left out as not user-visible:` +
        ` ${quiet.map((c) => `${short(c.sha)} ${c.subject}`).join("; ")}.-->`,
    );
  }

  return { markdown: lines.join("\n"), used: used.length, quiet: quiet.length };
}

function git(args) {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim()}`);
  return r.stdout;
}

function previousTag() {
  const out = git(["tag", "-l", "studio-v*", "--sort=-v:refname"]).trim();
  return out ? out.split("\n")[0] : "";
}

function commitsSince(ref) {
  // --no-merges: a merge carries no change of its own. The unit separator keeps
  // a subject that contains a pipe from splitting the record.
  const args = ["log", "--no-merges", "--pretty=format:%H%x1f%s"];
  args.push(ref ? `${ref}..HEAD` : "HEAD");
  return git(args)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, subject] = line.split("\x1f");
      return { sha, subject };
    });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const previous = opts.from || previousTag();
  const commits = commitsSince(previous);
  if (!commits.length) throw new Error(`no commits since ${previous || "the beginning"}`);

  const grouped = groupCommits(commits);
  const { markdown, used, quiet } = render({ version: opts.version, commits, previous, ...grouped });

  const path = join(repo, "release-notes", "studio", `${opts.version}.md`);
  if (opts.stdout) {
    process.stdout.write(markdown);
    return;
  }
  if (existsSync(path)) {
    throw new Error(`${path} already exists; this writes a new draft and never edits one`);
  }
  writeFileSync(path, markdown, "utf8");
  const from = previous || "(no earlier tag)";
  process.stderr.write(
    `wrote release-notes/studio/${opts.version}.md\n` +
      `  ${commits.length} commits since ${from}: ${used} item(s), ${quiet} left as a comment\n` +
      `  edit the TODO lines, then commit it with the release\n`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`notes-draft: ${err.message}\n`);
    process.exit(1);
  });
}
