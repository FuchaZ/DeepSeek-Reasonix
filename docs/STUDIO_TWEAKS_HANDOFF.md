---
owner: @Oliver-Rui
backup: @esengine
status: active
reviewed: 2026-11-13
---

# Reasonix Studio Tweaks — handoff

A personal fork of [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) on the
`studio` (2.x) line. This document is the state of the fork at its first pushed revision: what
changed, how it was checked, and what is still open.

## 1. What this revision changes

All paths are under `desktop/frontend-next/src` unless noted.

### Sidebar navigation, rebuilt as one list

- The icon rail and the open sidebar draw the **same rows from one table** (`ui/navdest.ts`
  `BAR` / `useBarEntries`). Before this, the two could disagree and one row could be offered
  twice; a duplicate 新建会话 row on the open sidebar is what prompted the change.
- `ui/SidebarDestinations.tsx` (new) renders those rows on the open column;
  `ui/NavMore.tsx` (new) holds the arrangement panel and the bar's own context menu.
- The panel opens **in two steps**: right-click the bar → a one-item menu (自定义导航栏) → the
  panel, which is centred with a scrim. One flat list, one row per entry, each row carrying a
  show switch and a drag handle. 新建会话 is always shown and cannot be switched off.
- Dragging reorders with a FLIP animation: the dragged row follows the pointer, crossed rows
  give way, and the order is persisted **on release only** — writing on every `pointermove` was
  what made it flicker.
- The rail's mode is now two answers, not three (`state/prefs.ts`): `collapsed` (shown while the
  workspace column is shut) and `off`. A stored `"on"` reads back as `collapsed`.
- The bar is separated from the project list by a hairline, matching the one above the settings
  row at the foot. The 项目 view name lost its pill.

### The conversation rail (right edge)

- Ticks are dense and right-aligned; only the left end moves, the way a ruler's ticks do. The
  viewport is one darker tick (`.srail-now`), not a painted band.
- No follow-the-pointer card. Pointing at a single message stretches **that tick** leftwards into
  a dark bar (`22×3px`, right edge fixed) and puts the message's own text in a card to its left
  (`.srail-card`), mirroring a left-edge list. Folded runs keep their own row list instead.
- `railgeom.grow()` and its neighbour magnification are gone: length is spent on the one place
  being read.

### 最近 ordering

- Ordering moved into the session filter menu, directly under 全部, as one row — not a toolbar
  button and not a switch.
- It cycles newest → oldest → unsorted, and the arrow on the right (↑ / ↓ / ⇅) always says
  which.
- A chosen scope is inked and ticked rather than painted as a block, and the menu's rows are
  the height of the conversation rows that opened it.

### Removed

- 社区与贡献者 and 赞助 left 关于: the QQ group, Discord, GitHub issues, the contributor list,
  and the PayPal, WeChat and Alipay QR codes.
- Every dependency went with them: `Community.tsx`, `Sponsor.tsx`, their tests,
  `contributors.json`, the three images, `sponsor.css`, `en_community.ts`, `en_sponsor.ts`,
  eight `community.*` / `sponsor.*` action entries, two settings anchors, and the sidebar's
  社区 entry.
- `communityLinks.ts` keeps only the maintainer, which the author line still shows.
- 抖音 (account id, copy button, QR code) — removed earlier in the same line of work.
- `RecentSessions.tsx` (the 最近 view) and its tests: 最近 is an ordering now, not a page.
- `Account.tsx`: after the sign-in card left the settings page, nothing in the product mounted
  it. It and its test are gone; the port methods stay, since the kernel still serves them.

### Session messages between projects (`internal/`)

- A dispatch may name the **role** of the session it creates (`DispatchToProject(ctx, project,
  text, role)`), so several sessions in one project do not read as one.
- New setting `peers.incoming`: what another of the user's sessions may send without a card —
  `ask`, `dispatch` (a paired session only, the default) or `always`. Only the asking is skipped;
  what the message starts still runs under this session's own approvals and sandbox.
- Sending by hand is gone from the UI: dispatch is the model's job, so the peers panel is the
  switches plus whatever is waiting for an answer.

## 2. How it was checked

Run from `desktop/frontend-next`:

| Check | Command | Result |
| --- | --- | --- |
| Types | `tsc --noEmit` | passes |
| Build | `vite build` | passes |
| UI census gate | `node tools/ui-census/main.mjs` | exit 0 — no orphaned action, no unregistered one |
| Census fixtures | `node tools/ui-census/verify.mjs` | `fixture reports identical across 10 outputs` |
| Focused tests | `vitest run src/actions.test.ts src/i18n/msg/msg.test.ts src/i18n/i18n.test.ts src/ui/AccountSettings.test.tsx src/ui/panel-dead-ends.interaction.test.tsx src/ui/Rail.test.tsx src/ui/railgeom.test.ts src/styles/railhit.test.ts src/ui/workspaces.test.ts src/ui/workspace-order.interaction.test.tsx src/ui/session-batch.interaction.test.tsx src/ui/nav-entries.interaction.test.tsx src/ui/nav-parity.interaction.test.tsx src/ui/navrail.interaction.test.tsx` | 14 files, 146 tests green |

Browser checks (Playwright + local Edge, `npm run dev` on :5273): the rail card sat 33px left of
its stretched tick with all tick right edges on one x; the filter menu measured 30px per row; the
fold-all button reported `lucide-chevrons-down-up` at 14px.

### Not verified

- **The full `vitest` suite** was not run here: it takes over ten minutes on this machine and the
  harness times a single file at 0.4s but a cold full run much longer. CI runs it
  (`.github/workflows/studio.yml`).
- **Go-side tests** were not run — no Go toolchain on this machine. CI's `ci.yml` covers the
  kernel: `gofmt`, lint, race, test.
- Dark theme was not screenshotted.

## 3. Publishing

CI is already in the repository; this fork did not add it.

| Workflow | Trigger | Covers |
| --- | --- | --- |
| `ci.yml` | push / PR to `studio` or `main-v2` | kernel: lint, race, test |
| `studio.yml` | push / PR to `studio` | `pnpm typecheck`, `pnpm test`, `pnpm census`, `pnpm census:verify`, `pnpm build` |
| `release-studio.yml` | push a `studio-v*` tag, or `workflow_dispatch` with an existing tag | packages, signs, publishes the GitHub release |
| `e2e-bot.yml` | comment `/e2e` on a pull request | end-to-end suite against the real provider |

**The branch matters.** `ci.yml` and `studio.yml` only run on `studio` (and `main-v2`), so work
on any other branch is unchecked until it lands there.

`release-studio.yml` expects credentials a fork does not inherit.

| Credential | Needed for | Without it |
| --- | --- | --- |
| `studio-release` environment | The publish job's approval gate | The release cannot publish |
| `APPLE_*` (five secrets) | Signing and notarizing macOS | macOS jobs cannot sign |
| minisign key | Signing every artifact | The publish job stops |
| R2 credentials | Mirroring and the Studio catalog | The release publishes, the catalog is not updated |
| Certum | Windows Authenticode, only when `vars.STUDIO_SIGNING_ENABLED` is `true` | Windows ships unsigned |

A candidate release can be published as a prerelease by using a pre-release version, which
also keeps it off the GitHub latest slot.

Note the version baseline: the branch's `release-notes/studio/` already carries `2.61.0.md`,
while the highest `studio-v*` tag on the remote is `studio-v2.50.0`. Choose the first tag with
that in mind.

## 4. Open items

- `Account`'s port methods (`accountLogin`, `accountPoll`, …) are still declared and still
  served by the kernel; only the UI is gone. If the sign-in card returns, restore
  `ui/Account.tsx` from git history rather than rewriting it.
- `SidebarTools.tsx` is reduced to the settings row; the hover card it used to draw was folded
  into `SidebarDestinations.tsx`.
- Nothing in the 任务 group idea from earlier discussions was implemented: the tree has no
  session that belongs to no workspace, so "非项目会话" has no data to stand on.
