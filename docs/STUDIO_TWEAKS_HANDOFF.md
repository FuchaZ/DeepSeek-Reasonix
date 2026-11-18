---
owner: @Oliver-Rui
backup: @esengine
status: active
reviewed: 2026-11-18
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

Note the version baseline: `release-notes/studio/` now carries `2.62.0.md`, while the highest
`studio-v*` tag on the remote is `studio-v2.50.0`. The first tag this fork pushes should
therefore be `studio-v2.62.0`.

## 4. Open items

- `Account`'s port methods (`accountLogin`, `accountPoll`, …) are still declared and still
  served by the kernel; only the UI is gone. If the sign-in card returns, restore
  `ui/Account.tsx` from git history rather than rewriting it.
- `SidebarTools.tsx` is reduced to the settings row; the hover card it used to draw was folded
  into `SidebarDestinations.tsx`.
- Nothing in the 任务 group idea from earlier discussions was implemented: the tree has no
  session that belongs to no workspace, so "非项目会话" has no data to stand on.

## 5. Revision 2.62.0

The first release of this line is **2.62.0**, and the notes now carry that name. Everything on
this page above describes the first revision; these six commits are what it took to make the
branch buildable and releasable as 2.62.0.

| Commit | Change |
| --- | --- |
| `e5591df` | Goldens refreshed to the dispatch schema in the tree (`role`, "one of the user's projects"). Before this the branch tip failed `internal/assembly/boot` on a difference the tree had already decided. |
| `3ff9d07` | `peers.incoming` decides what arrives without a card: `ask` holds, `dispatch` takes a paired session, `always` takes any. `SetPeersIncoming` refuses anything else, and the setting is writable from the settings sheet. |
| `08d63b8` | Cloud-backup row and the account/market search intents removed; 备份 lands on the local file backup. |
| `d788646` | A scope row's picker opens from the row's left edge instead of hanging off the right. |
| `1e1734d` | Six perf scripts reach 文件 through `openFiles`, as the ones fixed in `466dbfd` do. |
| `54b53eb` | Release notes renamed to `2.62.0.md`, upstream handover line, `peers.incoming` upgrade note. |

### Windows build on this machine

Installed 2026-11-13 at `%LOCALAPPDATA%\Programs\Reasonix Studio`; `logs/shell.log` records
`version=2.62.0 packaged=true platform=win32/x64` and a kernel handshake. The installer is
unsigned (`no code signing certificate configured`), so SmartScreen will warn on first run.

| Step | Command |
| --- | --- |
| SPA | `cd desktop/frontend-next && pnpm install --frozen-lockfile && pnpm build` |
| kernel | `PATH=<go>/bin:$PATH CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=v2.62.0" -o desktop/electron/bin/ ./cmd/reasonix-studio-host` |
| bundle | `pnpm exec electron-builder --dir -c.extraMetadata.version=2.62.0 -c.electronDist=<local electron-v45.2.3-win32-x64.zip>` |
| installer | `pnpm exec electron-builder --prepackaged ../../dist/win-unpacked --win nsis -c.extraMetadata.version=2.62.0` |

Three environment facts the CI recipe does not meet here:

- **No Go on PATH.** A portable go1.26.11 lives at `D:\Tools\gotool\go\bin`.
- **`build:host` cannot fetch the CUA driver.** Its GitHub fetch carries a 120s timeout and the
  line runs at ~40 KB/s. Fetch the lock file's artifact by hand, verify its sha256, and put
  `cua-driver.exe` in `desktop/electron/bin`.
- **electron-builder re-downloads Electron even when it is cached, and can hang for ten
  minutes.** Pass `-c.electronDist` pointing at a local zip.
- **Toolset downloads hit GitHub too.** Set
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`,
  or pre-seed `<LOCALAPPDATA>/electron-builder/Cache/<release>/<archive>`.

Artifact: `dist/ReasonixStudio-windows-amd64-installer.exe`, sha256
`d4e12da2e193fc916ed81ff792d11c90b71f5544c6a2740e8fba52dbc02256a9`, 135 MB. It installs per user
(HKCU uninstall entry `Reasonix Studio 2.62.0`), and every PE file is amd64 except the
installer's own 32-bit `resources/elevate.exe`.

### Checks run for this revision

| Check | Result |
| --- | --- |
| `gofmt -l` on the changed Go files | clean |
| `go vet` on the affected packages | clean |
| `go run ./tools/repolint -changed` (what `make check` runs; `make` is not installed here) | clean, after shortening a six-line comment and a 362-column paragraph |
| `go test ./internal/contract/... ./internal/session/control/ ./internal/frontend/serve/` | pass |
| `vitest run` on the four touched test files | 47 pass |
| `pnpm typecheck` | clean |
| `go test ./internal/assembly/boot/` | the goldens pass; two tests fail on this machine (`TestEffectBundledSkillReferenceReachesProviderAfterCopyInstall`, `TestEffectChangedFileEditAfterTheReadIsKept`, the latter panicking on an empty request list). Both fail the same way on `HEAD` without these commits, so they are not this revision's. |

### Open items for this revision

- **`README.md` and `README.zh-CN.md` still describe a 2.6.x line** ("2.6.1, 2.6.2, 2.6.3 … no jump
  to 2.7"). The release is 2.62.0. One of the two has to move before a tag is pushed.
- `internal/contract/tool/peer.go` and `internal/session/control/peer_dispatch.go` still say
  "another of the user's projects" while the tool now accepts this session's own project when a
  role is given. The model-facing description is right; these two comments are not.
- The two failing boot tests above need a clean-machine run (CI on Linux) before a tag; they are
  the only red in the packages this revision touched.
- Only Windows was built here. `.deb`, `.rpm`, `.AppImage` and the macOS bundle still rely on
  `release-studio.yml` and its credentials.

## 6. Revision 2.63.0

The second release of this line. Four commits, all frontend (`desktop/frontend-next`), pushed to
`studio` on `Oliver-Rui/DeepSeek-Reasonix-continued` — the remote was retargeted this revision; the
`Reasonix-Studio-Tweaks` URL in older notes never existed on GitHub.

| Commit | Change |
| --- | --- |
| `1e4451d` | **Not carried in this tree.** Two explicit groups in the session tree (项目 / 任务). |
| `75b11b9` | **Not carried in this tree.** The new-session 选择项目 card. |
| `d5436da` | Three layout fixes, each live-measured first: the settings windowbar's buttons opt out of the drag region (最小化/最大化/关闭 were dead while 设置 was open); the scope pill's chevron opts back to `inline-block` against the deliberate global `.studio-icon { display: block }`; scope dropdown rows declare their grid positions so an exception chip cannot auto-place into column one. |
| `17154c7` | `data.cloud_backup` — a key nothing had referenced since the feature left in 2.62.0's work. |

The README open item from §5 is closed: both READMEs now tell the 2.61.0 handover, the
`studio` line (2.62.0, 2.63.0, …), and point at this repository's releases page.

### Checks run for this revision

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `vitest run` (full) | 6788/6788 across 914 files; two files fail to load under the session sandbox (`?worker&url` transform denials on `pdfjs-dist`/`maplibre-gl`), unrelated to the diff |
| `npm run census` + `census:verify` | sealed; fixture reports identical |
| `repolint -changed` | clean |
| `vite build` | clean |
| The running app at 100% and 115% zoom | the picker, both groups, the pill, the dropdown rows and the windowbar verified; the windowbar's buttons also by computed `webkitAppRegion` with the platform attribute stubbed (the plain browser does not render them) |

## 7. The torch round — the other fork's sidebar, brought over

`Oliver-Rui/DeepSeek-Reasonix-torch` runs a parallel line on the same base
(`cd20bb50`, 2026-11-11). Ten of its commits were already here from the 2.62.0
round — `peers.incoming`, `titleauto`, the loopback provider grant, the market
and community removal — so this revision is what those rounds had not taken.

Four commits carry it: `0f7226c` (kernel data, door names, message times,
dispatch records), `2ad7fb3` (the dispatch chip and `peers.cross_project`),
`159861c` (the sidebar), `1cf3a43` (the prefix retirement).

### Kernel

- A sessions tree that nests transcripts by date is walked whole: listing, archive,
  empty reclamation, order and the removal boundary all read the tree, not one folder.
  `SetDatedSessionPaths` is set for the app's own folder only, so a project's
  conversations stay flat beside their siblings.
- A launch refuses the home directory a shortcut hands it (`sameRealDir`), and
  removing a project writes a tombstone (`workspacelist.List.Removed`, bounded at
  64) that no source listing unpicked folders writes back. Adding the folder again
  lifts it.
- `ListedModel.DisplayName` → `Probe.Names` → the check's `names`;
  `POST /providers/refresh-models` writes a saved endpoint's list back with those
  names as blank aliases, and a startup pass fills them once per process.
- `DispatchThread` and `dispatchBook.threads` are the sender's own record of what
  it dispatched and where each task landed, served by `GET /dispatch-threads`.
  `NoteDispatchedSession` carries the role, and `DispatchRoles()` outlives the
  partner's pane, which a live-runtime walk could not say.
- `peers.cross_project` answers always / paired / never, user file only, refused
  as `peer.invalid_cross_project`.
- `ModelShort` is the id's own last path segment and `sharedModelPrefix` is gone;
  `hide_model_prefix` still parses on both sides, and nothing reads it.

### Frontend

- Two standing runs with their own labels (`WorkspaceGroupHeaders`).
- One insertion line for project rows, group labels and conversation rows
  (`useWorkspaceDrag`, `useSessionMove.moveTo`, `dragghost`).
- A dated reading (`timeBuckets`, `railTimeGroups`) and the new-session pill
  (`WorkspacePill`, `BlankProjectDialog`, `useNewSessionPicker`).
- Message times (`messagetimes`, `MessageTimesSetting`), the dispatch chip
  (`DispatchThreadsBar`), the row's hover card (`SessionHoverCard`), and fifteen
  vendor marks behind `markForProvider`.

### Not taken, and why

- **The version catalog** (`studio_release_catalog.go`, `Versions.tsx`): it replaces
  the hub's install / pin with a plain download list, and this tree's release is
  `release-fork.yml`. Two designs, one of them has to go first.
- **The standalone cross-chat settings page** (`PeersChatPage.tsx`): it collides with
  §6's placement — the switches stay on the peers page this tree already has.
- Its CI workflows (`attach-studio-asset`, `issue-builder`), its brand, and the two
  workflows this tree deleted on purpose.

### Checks run for this revision

| Check | Result |
| --- | --- |
| `gofmt -l`, `go vet ./...` | clean |
| `go test ./internal/model/... ./internal/session/control/` | pass |
| `go test ./internal/frontend/serve/` (dispatch, peers, providers, tree, export, hub) | pass |
| `go test ./internal/state/sessionstore/ ./internal/state/workspacelist/` | pass, including the dated-folder and tombstone cases added here |
| `tsc --noEmit`, `npm run build` | clean |
| `vitest` sidebar suite (15 files) | 123/123 |
| `vitest` actions, i18n, sessions | pass, with `UNDECLARED_CEILING` at 213 |
| `repolint -changed` | clean; `Workspaces.tsx` carries its 358-line baseline |

### Debts

- `Workspaces.tsx` (1158 lines) is the round's carry-forward; the extraction that
  earns the ceiling back is the next pass.
- Three inline inputs on the new rows are still unnamed in the census (210 → 213;
  four others were named instead).
- The Windows build was made here at 2.65.0. `node packaging/build-host.js` cannot
  fetch the CUA driver on this machine, so the kernel comes from the same `go build`
  the script runs, and `reasonix-studio-host.exe` is reused from `bin/`.

## 8. The hover card yields to the row menu

A session row opens its detail card after 450 ms of hover; a right click opens the
row's action menu at the pointer. Both are fixed-position portals, and the card
(`z-index: 88`) painted above the menu (`70`), so the menu's top rows could land
under the card and stop taking clicks.

- `Workspaces.tsx` treats the two as one surface: opening any row menu cancels the
  waiting hover timer and clears the card, and rows arm no hover while a menu is
  open. Closing the menu restores the card on the next hover.
- Every way of opening the menu lands on that one state: right click, the row's
  `⋯` button, and the keyboard (`ContextMenu` / `Shift+F10`).
- New interaction test `session-hover-menu.interaction.test.tsx` (2 tests): a
  settled card gives way to the menu; other rows stay cardless while it is open;
  Escape closes the menu and the card returns.

Checks run:

- `tsc --noEmit` clean.
- Both new tests fail without the `Workspaces.tsx` change and pass with it.
- `session-hover-card`, `session-quick-actions`, `workspace-context-menu`,
  `session-move` and `session-batch` — 49 tests green.
- The same interaction was verified in the dev server (MockPort, `:5273`) by
  hovering a row, right-clicking it, and hovering again after Escape.

Android needs no separate frontend change:

- `android/scripts/sync-page.sh` rebuilds this same frontend and copies `dist/`
  into `assets/page/`; `android/scripts/build.sh release` runs it before Gradle.
- `./gradlew assembleRelease` alone reuses whatever is already in `assets/page/`,
  so a page change reaches the APK only through the sync.
- The gesture is a mouse one; the phone opens the menu with the row's `⋯` button,
  which now clears a lingering card through the same rule.

## 9. The collaboration chip reads the board, and only the board

Three faults, one surface: the 会话互聊 card drawn off the meter rail.

### The card's rows had no CSS

`CollaborationBoard` renders `.peerstate-name`, `.boardarrow`, `.peerrole`,
`.peergroup h4` and `.peerhint` — none of which existed in this tree. Only
`.peername` carried truncation, so the assignee's name was a bare `<button>`
that wrapped, and `styles/peers.css`'s `.peerrow { flex-wrap: wrap }` leaked
into the card and split every row across two lines. `design/sesscard.css` now
declares all of them under `.studio-peers-detail`, overrides `flex-wrap` to
`nowrap`, gives both ends `flex: 1 1 0` with ellipsis, and widens the card
300 → 340 px to fit two names, a role and a state column.

### A removed conversation stayed on the chip

Two independent causes, both fixed:

- `boardJoinMemo` caches one tree walk for 15 s and `knows()` treated that walk
  as authoritative even for peers it had already answered as absent. `Hub.treeChanged`
  — the one notification `watchTreeWrites` already emits for `/tree/*` and
  `/delete-session` — now calls `boardJoinMemo.invalidate()`, so an archive or a
  removal reaches the board at once.
- `DispatchThreadsBar` fell back to the sender's own `/peers` threads whenever
  the board came back empty. That record outlives both an archive and a removal
  and never filters them, so a deleted session's row was resurrected by the
  fallback. The chip is now driven by `/dispatch-board` alone: no `port`, no
  `usePeers`, no fallback. A window without the route draws nothing.

The chip also polls every 3 s again (it had been slowed to 10 s while both
sources were being read) and re-reads on `onTreeChanged`, so the change lands
without waiting out an interval.

### Dispatch takes back the session a role already names

The book that maps (sender, project, role) → pane lives in memory, so every
restart made the next dispatch open a second conversation beside the one that
role already had. `Hub.dispatchedPath` now reads it back from disk: a session
whose `RoleText` equals the requested role, **and** whose peer key the audit
trail shows this sender writing to, is reopened through
`OpenRequest.SessionPath` instead of spawning another. Both halves are required
— the role alone is not evidence, since a person can name their own
conversation the same way. A reused pane keeps its transcript
(`SetFreshSessionPath` only runs when the path is empty) and still adopts the
sender's grant.

Note on the source: `internal/session/control/dispatch_existing.go`, listed as
item C in the previous round, was **deleted** upstream in `57f50fb72` together
with the human dispatch entry — the model routes dispatch. This round therefore
implements what C was after (reuse, not a second session) rather than porting
that file.

### Checks run

| Check | Result |
| --- | --- |
| `go test ./internal/frontend/serve/ -run 'TestDispatch'` | pass |
| `TestDispatchTakesBackTheSessionARoleAlreadyNames`, `TestDispatchLeavesAConversationThePersonNamedThemselves` | pass |
| `TestTreeChangedDropsTheBoardWalk`, `TestDispatchBoardDropsAnEndArchivedAfterTheWalk` | pass; the latter archives through the real `POST /tree/sessions/archive` |
| `vitest run src/ui/dispatch-threads-bar.test.tsx` | 7 pass |
| `vitest run` the five MeterRail suites | 27 pass |
| `tsc --noEmit` | clean |
| `gofmt -l` on the touched Go files | clean |
| `go run ./tools/repolint -changed` | clean |
