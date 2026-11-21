---
owner: @FuChaZ
backup: @esengine
status: active
reviewed: 2026-11-22
---

# 会话交付图片预览 · 相对路径定位 · 构建提速 — 交接

本轮三件事，前两件已完成并有测试，第三件的验收数据在下面。改动已提交到
`work/studio-session-20261121`；未纳入的是本地 pnpm 11 造成的
`desktop/frontend-next/pnpm-lock.yaml` 漂移，以及它生成的
`desktop/electron/pnpm-workspace.yaml` 占位文件。

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
> `/workspace/resolve`。本意是"本来就对只花一次 stat"，但这毕竟是多一次请求。
> 若觉得不值，可改成只在读取报 `file_missing` 后再问——代价是标签页先用错名开一次。
> 这条待定，见第 4 节。

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
| 解包应用 | `node_modules/.bin/electron-builder --dir -c.electronDist=node_modules/electron/dist` | 5s |
| NSIS 安装包 | `node_modules/.bin/electron-builder --prepackaged ../../dist/win-unpacked --win nsis -c.extraMetadata.version=2.65.0` | 179s |
| 便携 zip | 同上，`--win zip` | 67s |
| 覆盖安装目录 | `Copy-Item -Recurse` 385 个文件 / 417MB | 0.7s |

结论：**不是 NSIS 的锅**。`electron-builder.yml` 的 nsis+zip 目标从 2.62 之前就在，本地
`--dir` 也一直是 7 秒级；安装包本身只多 3 分钟。真正能把一次构建拖到十几分钟的是：

- **Electron 每次重新联网。** 不传 `-c.electronDist` 时，electron-builder 会走
  `@electron/get`。
- 它每次构建都要重新拉 `SHASUMS256.txt`（`cacheMode: Bypass`，见
  `app-builder-lib/out/util/electronGet.js` 的注释），所以即使 158MB 的
  `electron-v45.2.3-win32-x64.zip` 已在缓存里仍要联网。
- 本机当前 34s 后报 `unable to get local issuer certificate`；网络慢时就是 2.62
  交接里记的「卡十分钟」。
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

# 内核（Go 要在 PATH 上；本机是 /d/Go tools/go/bin）
cd ../electron
PATH="/d/Go tools/go/bin:$PATH" node packaging/build-host.js

# 解包应用（用本地 Electron，不联网）
node_modules/.bin/electron-builder --dir -c.electronDist=node_modules/electron/dist

# 关闭 Studio 后，把 dist/win-unpacked 覆盖到 %LOCALAPPDATA%\Programs\Reasonix Studio
```

需要安装包时，复用上一步的 `win-unpacked` 再跑一次（+3 分钟，不触发 Electron
下载）：

```sh
node_modules/.bin/electron-builder --prepackaged ../../dist/win-unpacked \
  --win nsis -c.extraMetadata.version=2.65.0
```

> PowerShell 里把 `node_modules/.bin/xxx` 写成 `node_modules\.bin\xxx.CMD`；上面是
> Git Bash 写法。

## 4. 待办与未完成项

1. **`ask()` 的定位时机待定**（见第 2 节末）。当前每次点链接多一次请求。
2. ~~remote 用例补强~~ **已完成**：`ui/workbench-spelled-path.interaction.test.tsx`
   的 remote 用例现在挂上完整 WorkbenchPanel，先等标签页真的打开（`b.md`），再断言
   `workspaceResolvePath` 未被调用——4 条全过，tsc 干净。
3. **`internal/frontend/serve` 整套测试很慢**（本机 >600s，单次跑到 842s）。已用
   stash 验证：**在干净树上同样超时、同样在 `TestSabotageCountingHostWorkAddsAStepNobodyTook`
   失败**，是既有问题，不是本轮引入。需要单独排查。
   总量超限已在本轮修掉：`studio.css` 合并两行回到预算内、`SESSION_HANDOFF.md`
   补 `backup` 并在 CODEOWNERS 登记、四处超长块拆成列表。
5. **已提交**到 `work/studio-session-20261121`。文件清单见下。

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

## 6. 底栏「会话互聊」图标与悬停面板（本轮只调研，未改）

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

**当前代码落点**（供后续接手）：

- `ui/Pane.tsx:699`：把 `<DispatchThreadsBar port={port} .../>` 传给 `MeterRail`
  的 `peers` 插槽（`MeterRail.tsx:59,124`）。这是底栏那一处的唯一挂载点。
- 组件 `ui/DispatchThreadsBar.tsx`；样式 `design/sesscard.css:35-66`；
  数据来自 `GET /peers` 的 `threads`（`internal/frontend/serve/peers.go`）。

**最小改动方案**（用户已叫停，本轮未执行）：

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
