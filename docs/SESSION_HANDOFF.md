---
owner: @FuChaZ
backup: @esengine
status: active
reviewed: 2026-11-22
---

# 会话交付图片预览 · 相对路径定位 · 构建提速 — 交接

主体三件事（1–3 节）已完成并有测试。2026-11-22 凌晨追加一轮（4–6 节的状态都是那轮
写定的），四件事：

- reveal 通道（`/workspace/locate`）补上同一个尾部定位，点「打开」不再对拼写路径 404。
- 底栏「会话互聊」chip 与悬停卡成套摘除（第 6 节）。
- serve 套件唯一真失败（`workspace.path_ambiguous` 缺桌面译名）修复；慢的排查结论
  见第 4 节第 3 条。
- frontend-next 的 7 条既有失败全修（都是测试押着旧形状，无产品 bug），见第 4 节
  第 4 条。
- 从 torch 线移植 ghost row（第 7 节）。

**当前两条套件 0 败**：serve 1483 过 / 31 skip，frontend-next 934 文件 / 6911 测试
全过（ghost row 移植后的复核见第 7 节）。改动全部提交在
`work/studio-session-20261121`；未纳入的是本地 pnpm 11 造成的
`desktop/frontend-next/pnpm-lock.yaml` 漂移，以及它生成的
`desktop/electron/pnpm-workspace.yaml` 占位文件。

2026-11-23 追加一轮：卡顿排查与修复（第 8 节，`156561e9c`），以及打包版本号
教训（§3.1 命令块已更正——版本必须在 `--dir` 步注入，`--prepackaged` 补不了；
host 用 `REASONIX_VERSION`）。

## 1. 交付卡片里的图片直接预览（已完成）

会话回复里由 `present_files` 交付的 png/jpg，原来只有一行「图标 + 文件名 + 打开」。
现在图片会在那一行上方多画一张预览图。

- `ui/document/DeliveryCard.tsx`：新增 `DeliveryPicture`，用 `fileKind()` 判断是不是
  图片，`ImagePreview` 包住 `<img>`（点开是共用的缩放查看器）。加载失败时
  `setFailed(true)`，预览图消失、退回原来那一行，不留破图。
- `ui/document/delivery.css`：新增 `.delivery-picture` 等 5 条规则。选择器写成
  `.delivery-file > .delivery-picture`，因为 `image-preview.css` 的 `.image-trigger`
  带 `border: 0`，同优先级下由样式表顺序决定胜负。
- `ui/Markdown.tsx` / `ui/useConversationFiles.tsx`：`LocalRefs` 加可选
  `imageOf?(ref)`，把交付文件的 `{path, root}` 交给现有的受控图片通道
  `port.workspaceImageURL(path, root)`。没有走新路由，也没有把本地路径塞进 `<img>`。

验证：`DeliveryCard.test.tsx` 新增 6 条（15 条全过）；新增
`perf/delivery-picture.mjs` 浏览器驱动，浅/深 × 1440/520px 共 28 项断言全绿，
确认了图片不压住文件行、不越出卡片、长图受 260px 高度约束、坏图回退。

## 2. 相对路径打不开（已完成）

**现象**：会话里链接显示 `target/release/misyrup-gui.exe`，点开报「找不到该文件」，
文件实际存在。

**根因**：会话根目录是 `D:\外设驱动`，模型在 `D:\外设驱动\misyrup-rs` 里跑
`cargo build`，写出的路径是相对**那个**目录的。前端一律按工作区根拼成
`D:\外设驱动\target\release\...`，404。文件真实位置：
`D:\外设驱动\misyrup-rs\target\release\misyrup-gui.exe`。

**修法**（按尾部唯一定位，不做猜测）：

- `internal/base/workspacefile/suffix.go`（新增）：`Service.Suffix(written)`。先按原样
  `Resolve` + `Stat`，命中就返回——正常路径只花一次 stat，不遍历。
- 没命中才在授权根下按路径尾部匹配，最多收集 2 个命中，多于 1 个返回 `ErrAmbiguous`。
- 遍历跳过 `node_modules`、`vendor`、`.git` 等（`skipScanDir`），否则一次查找会变成
  几分钟的磁盘扫描。返回的 `Ref` 保留找到它的那个根。
- `workspacefile/file.go`：新增 `ErrAmbiguous`。
- `session/control/workspace_preview.go`：`Controller.WorkspaceResolvePath`，与预览
  共用同一套 `previewFiles()` 根政策。
- `session/control/port.go`：接口加这个方法。
- `frontend/serve/workspace_preview.go`：新增 `GET /workspace/resolve?path=...`，
  404 用 `workspace.file_missing`，409 用新码 `workspace.path_ambiguous`。
- `frontend/serve/workspace_locate.go`：reveal 通道（`GET /workspace/locate`，Electron
  的「打开/显示」走这条）补上同一个尾部回退——上一轮只接了 preview 通道，点「打开」
  对拼写路径仍然 404。字面命中只花一次 stat；未命中才遍历，歧义返回
  `workspace.path_ambiguous`。
- 前端接口：`port/workspace.ts` 的 `WorkspacePreviewPort` 加 `workspaceResolvePath`。
- `port/sse.ts` 实现（非 2xx 一律返回 null，这属于"问不到"，不是错误）；
  `port/mock_workspace.ts` 返回 null（**不要**在 mock 里读文件，会踩到测试对读路径的
  spy）。
- `ui/useConversationFiles.tsx` 的 `ask()` 在打开前查一次，命中且路径不同就改开真实
  路径；`remote` 为真时跳过——远端 kernel 的路径指的是它自己的盘。

> 注意：`ask()` 是**所有对话链接**的入口，所以每次点链接都会发一次
> `/workspace/resolve`。定位时机已定案（保持现状），理由见第 4 节第 1 条。

验证：

- `suffix_test.go` 8 条。
- `workspace_preview_test.go` 新增 2 条路由测试（含"解析出来的路径真的能读"）。
- 新增 `ui/workbench-spelled-path.interaction.test.tsx` 4 条（定位成功、路径本来就对
  不重复开、定位不到保留"找不到"、remote 不问）。
- Go 侧 `./internal/base/workspacefile` 与
  `./internal/frontend/serve -run 'TestLocate|TestHubRefusesToLocate|TestWorkspace...'`
  全过（locate 新增 3 条：定位成功、歧义拒绝、不猜）。
- 前端相关 3 个套件 25 条全过。

## 3. 编译慢（已完成）

**根因**：`desktop/electron/run-studio.sh` 判内核过期就调 `build:host`，而
`packaging/build-host.js` **无条件**执行 `packaging/install-cua-driver.js`，后者每次都
从 GitHub 下载约 100MB 的驱动包再解压校验，**没有任何"已经装好"的判断**。该步骤由
2026-10-13 的提交 `88129d0f6` 引入，正好对应用户说的"以前很快"。

**修法**：驱动文件旁写 `bin/cua-driver.exe.artifact`，内容是 `<包名> <sha256>`；
匹配则直接返回。没有 stamp 的老安装用 `--version` 认领（`installedVersion`），
版本等于 `lock.version` 就补写 stamp、不再下载。为可测试加了 `into` 与 `probe`
两个注入参数。

实测：`node packaging/install-cua-driver.js` 从「每次下载」变为 **0.17–0.23s**；
`node packaging/build-host.js` 全程 **9s**。electron 单测 **204 通过 / 0 失败**（新增 2 条：
认领同版本、不认领别的版本）。

### 3.1 打包慢的另两个来源（2026-11-21 复测）

用户说 2.62 时不到十分钟就能出「可以替换到安装版」的内容，现在慢得太多。按步骤实测
（本机热缓存，Windows amd64，**直接调用本地二进制，不经 pnpm**）：

| 步骤 | 命令 | 耗时 |
| --- | --- | --- |
| SPA | `node_modules/.bin/tsc -b && node_modules/.bin/vite build`（frontend-next） | 6s |
| 内核 | `node packaging/build-host.js`（CUA stamp 命中） | 9s |
| 解包应用 | `node_modules/.bin/electron-builder --dir -c.electronDist=node_modules/electron/dist -c.extraMetadata.version=2.67.0` | 5s |
| NSIS 安装包 | `node_modules/.bin/electron-builder --prepackaged ../../dist/win-unpacked --win nsis -c.extraMetadata.version=2.67.0 -c.nsis.artifactName='ReasonixStudio-windows-${arch}-${version}-installer.${ext}'` | 179s |
| 便携 zip | 同上，`--win zip -c.win.artifactName='ReasonixStudio-windows-${arch}-${version}-portable.${ext}'` | 67s |
| 覆盖安装目录 | `Copy-Item -Recurse` 385 个文件 / 417MB | 0.7s |

**安装包文件名必须带版本号**（`ReasonixStudio-windows-amd64-<版本>-installer.exe`）：
`electron-builder.yml` 的默认 `artifactName` 没有版本，`release-fork.yml:113-114` 的
发布工作流是靠 `-c.nsis.artifactName` / `-c.win.artifactName` 覆盖补上的——本地命令漏了
这个覆盖就会产出无版本名的安装包（2026-11-23 又踩了一次：2.67.0 的包先是
`ReasonixStudio-windows-amd64-installer.exe`，靠手工改名补救）。

结论：**不是 NSIS 的锅**。`electron-builder.yml` 的 nsis+zip 目标从 2.62 之前就在，本地
`--dir` 也一直是 7 秒级；安装包本身只多 3 分钟。真正能把一次构建拖到十几分钟的是：

- **Electron 每次重新联网。** 不传 `-c.electronDist` 时，electron-builder 会走
  `@electron/get`。
- 它每次构建都要重新拉 `SHASUMS256.txt`（`cacheMode: Bypass`，见
  `app-builder-lib/out/util/electronGet.js` 的注释），所以即使 158MB 的
  `electron-v45.2.3-win32-x64.zip` 已在缓存里仍要联网。
- 本机当前 34s 后报 `unable to get local issuer certificate`；网络慢时就是 2.62
  交接里记的「卡十分钟」。**修法（2026-11-23 实测）**：`NODE_USE_SYSTEM_CA=1`——这台
  机器到 GitHub 的 TLS 链路带了一个 Node 自带 CA 包不认的证书链，curl 走 Windows 系统
  证书库所以一直成功，Node 默认 CA 包必失败；让 Node 信任系统证书库后 `fetch` 即 200，
  `build:host` 的驱动下载与 electron-builder 的工具集下载都直接走通，交接文档旧版本的
  「手动搬驱动到 bin/」与「工具集镜像」两个规避步骤都不再需要。
- 2.62 的构建命令带了 `-c.electronDist=<本地 zip>`，后来的 `build:app` 没带。
- **CUA 驱动** 见上一节，已修复。
- `go test ./internal/frontend/serve` 的 **842s** 是测试，不是编译/打包（见第 4 节）；
  若构建前跑整套测试，会额外多出约 14 分钟。

已改：`desktop/electron/package.json` 的 `build:app` 加上
`-c.electronDist=node_modules/electron/dist`，直接用已安装的 Electron 解包，
不再联网。实测 5–7s。`build:dist` 保持原样，因为 CI 要用它做跨架构构建
（`node_modules/electron/dist` 只有宿主架构）。

**构建不要走 pnpm。** `pnpm build` / `pnpm build:host` / `pnpm exec` 只是把下面这些
本地命令再包一层，没有额外步骤；pnpm v11 还会在每次执行时打一条 `package.json` 的
`pnpm` 字段告警。pnpm 只在装依赖时需要（首次，或 `pnpm-lock.yaml` / `package.json`
变动后）：

```sh
cd desktop/frontend-next && pnpm install --frozen-lockfile
cd ../electron && pnpm install --frozen-lockfile
```

之后所有构建都直接调用 `node_modules/.bin/` 下的二进制。本地替换安装版的快路径
（约 20 秒 + 复制）：

```sh
# SPA（tsc -b 不能省，vite build 本身不做类型检查）
cd desktop/frontend-next
node_modules/.bin/tsc -b && node_modules/.bin/vite build

# 内核（Go 要在 PATH 上；本机是 /d/Go tools/go/bin）。REASONIX_VERSION 注入
# host 自述的版本，与包版本保持一致
cd ../electron
REASONIX_VERSION=<版本号> PATH="/d/Go tools/go/bin:$PATH" node packaging/build-host.js

# 解包应用（用本地 Electron，不联网）。版本必须在这一步注入：
# app.getVersion() 读的是此刻打进包里的 package.json（树上永远是 0.0.0），
# --prepackaged 阶段补传 extraMetadata 改不了已打好的归档（2026-11-23 实测
# 打出的包 About 页仍读 0.0.0）。CI 同序：release-studio.yml 的
# "Build the bundle" 步。
node_modules/.bin/electron-builder --dir -c.electronDist=node_modules/electron/dist \
  -c.extraMetadata.version=<版本号>

# 关闭 Studio 后，把 dist/win-unpacked 覆盖到 %LOCALAPPDATA%\Programs\Reasonix Studio
```

需要安装包时，复用上一步的 `win-unpacked` 再跑一次（+3 分钟，不触发 Electron
下载）。`--prepackaged` 时把 `-c.extraMetadata.version` 写成同一个版本号，让
安装包元数据与包内一致（真正生效的是 `--dir` 那一步）：

```sh
node_modules/.bin/electron-builder --prepackaged ../../dist/win-unpacked \
  --win nsis -c.extraMetadata.version=<版本号>
```

> 文件名本身不带版本号：`artifactName` 是仓库规定（`-installer` 后缀是
> studio-manifest 的渠道识别），带版本的名字是发布流水线发布时另起的。本地
> 发布给自己用，装完自己 `mv` 一个版本号上去即可。

> PowerShell 里把 `node_modules/.bin/xxx` 写成 `node_modules\.bin\xxx.CMD`；上面是
> Git Bash 写法。

## 4. 待办与未完成项

1. ~~`ask()` 的定位时机待定~~ **已定（2026-11-22）：保持现状**。备选方案（读取报
   `file_missing` 后才问 resolve）省下的只是一次本机回环请求（服务端通常一次 stat，
   亚毫秒级），代价是可解析路径先闪一次「找不到」再改开——不值得。真正丢文件时两种
   方案都要付同一次工作区遍历，所以差异只有这一次亚毫秒请求对一次可见的闪失。
2. ~~remote 用例补强~~ **已完成**：remote 用例现在挂上完整 WorkbenchPanel，先等
   标签页真的打开，再断言 `workspaceResolvePath` 未被调用——4 条全过。
3. **`internal/frontend/serve` 整套测试很慢**（本机 662–842s，>go test 默认 600s 超时）。
   已排查（2026-11-22），要点：
   - **没有"失败"的测试**：`TestSabotageCountingHostWorkAddsAStepNobodyTook` 单独跑
     1.27s 就过；之前被点名是因为整套超过默认 10 分钟超时，panic 列出当时正在跑的
     无辜测试。
   - verbose 计时：1483 过 / 1 败 / 31 skip / 661.7s。那次唯一的失败
     `TestEveryRefusalCodeIsTranslated` 是 `workspace.path_ambiguous` 缺桌面译名，
     **已修**。
   - 分布是长尾：最慢 25 个合计约 170s，都是固有成本——ask 超时测试证明的就是产品
     下限 `MinAskTimeoutSeconds=10`；tree/archive 夹具的 348 个会话文件计数是断言的
     一部分；mux soak 证明百窗格。
   - **主因是结构性的**：1516 个测试 0 个 `t.Parallel()`，隔离全靠 `t.Setenv`
     （进程级环境变量，与 `t.Parallel` 互斥）。
   - 根治方向：拆包多二进制并行（`go test -p`），或把 `t.Setenv` 隔离改成注入式。
     本机安全跑法：`-timeout 18m`。
4. ~~frontend-next 全量 7 条既有失败~~ **已修（2026-11-22），全是测试押着旧形状，
   无产品 bug**：
   - navrail 3 条：设置落点还押着已废除的「plain open 落 session」规则。改为新规则：
     用量是 solo 页、不记录停留页，随后的 plain open 是首访，落 `common`。
   - dockgrid 1 条：网格被 `2cfafd20d` 有意加了 `pilltop` 行，期望补上。
   - ModelPrefix 1 条：模型下拉自 `78b1b5513` 起恒有「随上次选择」行，期望补上。
   - settings-search 2 条：新落点规则让 plain open 依赖上一用例记住的页面；用例先清
     `rx-settings-page`，命中查询限定到搜索 listbox（常用页自己的下拉也带 option）。
   - 修后全量 **934 文件 / 6911 测试全过**。CI 仍不跑这套件（ci.yml 头注：Studio
     表面只在用户机器存在）。全量约 350s（~1.46s/worker 的隔离开销约 135s，
     `isolate: false` 可省）。
5. **仓库门禁 `go run ./tools/repolint -changed` 全绿**（2026-11-22 复核）。上一轮
   遗留的三项仓库总量超限已修掉：`studio.css` 合并两行回到预算内、`SESSION_HANDOFF.md`
   补 `backup` 并在 CODEOWNERS 登记、四处超长块拆成列表。顺手修掉树上 gofmt 漂移的
   `internal/platform/update/release_unit_test.go`（`52ede7a97`）。
6. **已提交**到 `work/studio-session-20261121`。上一轮清单见第 5 节；追加轮清单见
   第 5.1 节。

## 5. 本轮改到的文件

```
desktop/electron/packaging/install-cua-driver.js     构建提速
desktop/electron/package.json                         build:app 用本地 Electron，不再联网
desktop/electron/test/unit.mjs                        +2 用例
desktop/frontend-next/src/port/mock_workspace.ts       mock resolve
desktop/frontend-next/src/port/sse.ts                路由实现
desktop/frontend-next/src/port/workspace.ts          +workspaceResolvePath
desktop/frontend-next/src/ui/Markdown.tsx             +LocalRefs.imageOf
desktop/frontend-next/src/ui/useConversationFiles.tsx 链接打开前定位
desktop/frontend-next/src/ui/document/DeliveryCard.tsx 图片预览
desktop/frontend-next/src/ui/document/DeliveryCard.test.tsx
desktop/frontend-next/src/ui/document/delivery.css
desktop/frontend-next/src/ui/workbench-spelled-path.interaction.test.tsx  (新增)
desktop/frontend-next/perf/delivery-picture.mjs        (新增) 浏览器驱动
internal/base/workspacefile/suffix.go                  (新增)
internal/base/workspacefile/suffix_test.go             (新增)
internal/base/workspacefile/file.go                    +ErrAmbiguous
internal/session/control/workspace_preview.go          +WorkspaceResolvePath
internal/session/control/port.go                       接口
internal/frontend/serve/workspace_preview.go           +GET /workspace/resolve
internal/frontend/serve/workspace_preview_test.go      +2 路由用例
internal/frontend/serve/workspace_locate.go            reveal 通道同样按尾部定位
internal/frontend/serve/workspace_locate_test.go       +3 用例
docs/FILE_PREVIEW.md                                   卡片图片预览说明
```

`WorkbenchPanel.tsx` 中途加过 `onMissing` 回调，后来判定归属层不对（`documentView`
决定 `useWorkbenchFiles` 的 path 为空，`.exe` 走的是文档预览路径，回调根本不触发），
已完全回退，`git diff` 现在为空——它不在上面的清单里。

### 5.1 追加轮（2026-11-22 凌晨）改到的文件

```
desktop/frontend-next/src/i18n/kernel.ts               +workspace.path_ambiguous 译名映射
desktop/frontend-next/src/i18n/msg/kernel.ts           +译名文案（中/英）
desktop/frontend-next/src/ui/DispatchThreadsBar.tsx    (删除) chip 组件
desktop/frontend-next/src/ui/dispatch-threads-bar.test.tsx (删除)
desktop/frontend-next/src/ui/Pane.tsx                  摘掉 peers 插槽与 import
desktop/frontend-next/src/ui/MeterRail.tsx             摘掉 peers prop
desktop/frontend-next/src/ui/panetypes.ts              摘掉 onOpenPeerSession
desktop/frontend-next/src/ui/App.tsx                   摘掉 openPeerSessionStable
desktop/frontend-next/src/design/sesscard.css          摘掉 chip 规则（34 行）
desktop/frontend-next/src/i18n/msg/chat.ts             摘掉两个专用 key
desktop/frontend-next/src/ui/navrail.interaction.test.tsx        落点断言跟新规则
desktop/frontend-next/src/styles/dockgrid.test.ts               +pilltop 行
desktop/frontend-next/src/ui/ModelPrefix.test.tsx               +随上次选择行
desktop/frontend-next/src/ui/settings-search-language.interaction.test.tsx  密封化
internal/platform/update/release_unit_test.go          gofmt
docs/SESSION_HANDOFF.md                                本文件的各节更新
```

## 6. 底栏「会话互聊」图标与悬停面板（~~只调研~~ → 已摘除，2026-11-22）

**已执行**（2026-11-22）：底栏 chip 与悬停卡按下面的方案成套摘除：
- 摘掉的：组件 `DispatchThreadsBar.tsx` 与它的测试、`Pane` 的 `peers` 插槽、
  `MeterRail` 的 `peers` prop、`onOpenPeerSession`、`openPeerSessionStable`、
  `sesscard.css` 的 chip 规则、两个专用 i18n key。
- 保留的：设置页「会话互聊」、`PeerHeldBar`、`SessionHoverCard`、`PeerThreadMark`、
  后端 peer 能力。
- 验证：orphan 与 i18n 门禁、MeterRail/Pane/Peer 相邻套件、设置页套件全过。
  研究记录保留如下。

**现象**：每条会话底栏 MeterRail 上有 `会话互聊 N` 小徽章，悬停展开一张卡片
（`处理『…』的回信` / `已派发 N 个会话`）。用户不想要这个图标和这张卡片。

**结论：不是漏删，是被有意留下的旧实现。**

- 之前那轮删除（`78b1b5513` + `04cbee846`）后由 `fa8a673fc`（11-19 13:15）回退。
- 删掉的是「协作工作板」：`/dispatch-board` 路由、`dispatch_board.go` /
  `dispatch_status.go` / `hub_rename.go`、`rename_session` 工具、role 进系统提示词、
  本项目/跨项目分组与状态灯。
- chip 被有意退回旧实现。提交说明原文：*the frontend chip goes back to the
  sender's own record*。所以现在看到的是回退后的形态，不是没删干净。
- 真正「整块功能删光」的是 `c2e58be4a`（11-19 22:58），只在 `remotes/oliver/torch`
  线上，随 `studio-v2.66.1` / `2.67.0` 走。本线 `origin/studio`（= `z2.66.0`）
  与它无共同祖先，从未合入，不存在漏合并。
- 与版本无关：chip 源码 blob 在 `z2.65.0`、2.65.1（`4c5a29583`）、`z2.66.0`
  三处完全相同（`2e4ccabd`）。本机安装版 bundle 里也没有 `会话协作工作板` /
  `dispatch_board`。2.65.1 → 2.66.0 升级不改变这里的行为。

**摘除前的代码落点**（历史记录，组件已不在树上）：

- `ui/Pane.tsx:699`：把 `<DispatchThreadsBar port={port} .../>` 传给 `MeterRail`
  的 `peers` 插槽（`MeterRail.tsx:59,124`）。这是底栏那一处的唯一挂载点。
- 组件 `ui/DispatchThreadsBar.tsx`；样式 `design/sesscard.css:35-66`；
  数据来自 `GET /peers` 的 `threads`（`internal/frontend/serve/peers.go`）。

**当时的方案**（已按此执行，保留作记录）：

- 摘掉 `Pane.tsx:699` 的 `peers` 传参，图标与卡片即消失。但仓库有门禁，
  不能只摘这一行：`src/orphan.test.ts` 会让未挂载组件失败，
  `msg.test.ts` 会让未使用的 i18n key 失败，删除必须成套。
- 连带清理：`Pane.tsx:68` 的 import、`panetypes.ts:89` 的 `onOpenPeerSession`、
  `App.tsx:365-370,705` 的 `openPeerSessionStable` 接线、
  `MeterRail.tsx` 的 `peers` prop、`sesscard.css` 的 chip 规则、
  `msg/chat.ts:140-141` 两个专用 key、测试 `ui/dispatch-threads-bar.test.tsx`。
- 注意 `App.tsx:541` 的 `PeerThreadsProvider` 仍用 `openPeerSession`，要保留，
  别和 `openPeerSessionStable` 一起删掉。
- 不要动：设置页「会话互聊」整页（`Settings.tsx:443`）、`PeerHeldBar`、
  `SessionHoverCard`、侧栏 `PeerThreadMark`、后端 peer 能力——用户只要底栏这一处消失。

## 7. 从 torch 线移植：ghost row（移除项目 → 归档可找回，2026-11-22）

**来源**：torch `def7e765a`（内核归档）+ `ea3b7656c`（tombstone 记录目录、呈现层）。
两线历史不相交，不能 cherry-pick——按树 diff 手工移植（torch 的提交说明原文有
他们对照 Slack/Linear/VS Code 的取舍记录，值得读）。

**行为**：
- 移除项目时归档其全部会话（子代理转录除外）。
- tombstone 记录移除时看到的目录拼写（`RemovedPaths`，旧记录按身份回退，前代版本
  滞留的归档因此找回）。
- 已移除文件夹只要还有可列会话就以 ghost row 出现在「已归档」范围和搜索结果里，
  日常列表保持干净（除非该文件夹里还有活工作：开着窗格或有未归档会话）。
- 删掉最后一条会话时 ghost row 与移除记录一起退役。
- 「放回列表」（同 add）或重新添加文件夹即整行恢复。

**落点**：
- `internal/state/workspacelist/list.go`：`RemovedPaths` 字段，`Remove(id, path)`，
  `Restore` 清路径，`Read` 保持两字段同形。
- `internal/frontend/serve/workspace_archive.go`（新增）：`archiveWorkspaceSessions`
  与 `workspaceHasListableSessions`。
- `internal/frontend/serve/workspace_list.go`：`removedWorkspaceEntries` /
  `pruneRemovedWorkspaceRecord` / `ghostRoots` / `ghostIsLive` /
  `pruneRemovedRecordForSessionDir`；`forgetWorkspace` 记目录。
- `internal/frontend/serve/hub_tree.go`：`treeWorkspace.Removed`（ghost 不吃陈旧
  置顶）、ghost 可见性规则（仅 archived scope 与搜索，活工作例外）、`rootRef.removed`、
  `roots()` 追加 ghost；移除时归档+退役+`treeChanged`；删除会话后按目录退役。
- `internal/frontend/serve/hub_tree_remove_many.go`：批量删除按目录退役。
- 前端：`port/hub.ts` `removed`（wire-parity 门禁强制）、`actions.ts`
  `workspace.restore`、两个 i18n key、`sidebar.css` 暗淡规则、`Workspaces.tsx`
  渲染+菜单（恢复/移除互斥）、`ghost-row.interaction.test.tsx`。
- 内核测试：`hub_tree_removed_test.go`（新增 4 条，从 torch 按行移植）。

**验证**：内核受影响域 151s 全过；4 条 ghost 测试全过；前端 ghost+remove 6 条全过；
`Workspaces.tsx` 压回预算（1157/1158，未放宽基线）。

## 8. 卡顿排查与修复 + 打包版本号教训（2026-11-23）

**症状**：长对话打开/长跑后 GUI 卡顿（流式时 R 标与计时徽标丢帧、打字掉帧）；
侧栏折叠必卡且重载不缓解。

**诊断**（帧采样实测 + 两条机制线）：

- 交互卡顿 = 每个 wire 事件的 O(全记录) 扫描 ×14 处、定位轨每帧（且每渲染
  重建 observer）对全部挂载块强制布局、每事件全量 Block 双重渲染、
  `/status` 每秒 4 次双份 `JSON.stringify`。
- 折叠卡顿 = `.app` 上注册型继承自定义属性的 CSS 补间逐帧重算 `.flow` 外
  整棵树 + 折叠首帧挂载/卸载整棵会话树 + 折叠期 ResizeObserver 风暴。
- `perf/README` 自己警告过：空闲快机器上 60fps，卡的从来不在这一档——
  复测用了 ×6 降频档。

**已修**（`156561e9c`，13 文件）：

- 定位轨 RO 节流 150ms + measureRef 解耦；`railMarks`/owed/echoes/paired
  身份稳定；七处扫描按既有 revision-memo 范式收敛；`sameJson` 替换双份
  stringify；held 选区抽 `heldselection.ts`。
- 教训：`useEarlierFold` 的切片**不能** revision 化——它是流式渲染源
  （`live = items[tail]`），文本 delta 不 bump revision，锁死后流式文本
  不渲染，被 `pane-visibility` 等四个测试文件抓住回退。

**实测**（×6 降频 t2000）：

- 滚动 p50 127-644ms → 84-162ms；折叠最好 case p50 403ms → 76ms。
- 空闲档两版都满帧（模拟内容轻，拉不开差距）。
- 剩余折叠成本 = B1（属性补间逐帧重算）+ B2（首帧挂树），属设计取舍，
  **待用户拍板方案**后做第二批。

**打包版本号教训**：

- 本地快路径此前漏了版本注入——app 版本来自 `--dir` 步打进归档的
  package.json（树上恒为 0.0.0），`--prepackaged` 补传 extraMetadata 无效
  （实测 About 页 0.0.0，与上两轮改动无关）。
- host 版本靠 `REASONIX_VERSION` 注入 ldflags。
- §3.1 的命令块已更正，**以后打包必须带版本号**，与 CI 同序。
