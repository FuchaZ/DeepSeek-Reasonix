---
owner: @FuChaZ
backup: @esengine
status: active
reviewed: 2026-11-26
---

# Studio 会话交接：从图片预览到 2.69.3（第 1–15 节）

**先读这一节。** 文档按轮次累积，早期的节保留当时的判断（包括被推翻的），
越往后越新。当前状态以第 14、15 节为准：

- **已发布**：2.69.3（`z2.69.3` = `ef3952f97` = HEAD）。2.67.1 之后没有单独发布过
  2.68 与 2.69.x，这一版是手动汇总（第 14.1 节）。
- **分支**：`studio`，与 `origin/studio` 同步。早期节里提到的
  `work/studio-session-20261121` 已不存在，那些改动都已进 `studio`。
- **`oliver` / `torch` 远端是独立历史**（无共同祖先，用它们自己的
  `TORCH_HANDOFF.md`），本文档的判断一律以 `origin` 线为准。
- **serve 慢但有解**：`go test ./...` 仍约 700s（最慢的包就是它，`-p` 只管包之间）。
  只验证 serve 用 `make test-serve`，三片并行实测 5m8s（第 16 节）。
- **本机环境限制**：没有创建符号链接的特权，`TestCompositionLinkedExtensionResources`
  等少数用例因此失败，与代码无关（第 15.4 节）。

以下是按轮次累积的历史记录，**出发点是 2026-11-21 那一轮**（当前的版本与分支状态见
文首那一节，不要以这里的数字为准）。

起点是主体三件事（1–3 节），已完成并有测试。2026-11-22 凌晨追加一轮（4–6 节的状态都是
那轮写定的），四件事：

- reveal 通道（`/workspace/locate`）补上同一个尾部定位，点「打开」不再对拼写路径 404。
- 底栏「会话互聊」chip 与悬停卡成套摘除（第 6 节）。
- serve 套件唯一真失败（`workspace.path_ambiguous` 缺桌面译名）修复；慢的排查结论
  见第 4 节第 3 条。
- frontend-next 的 7 条既有失败全修（都是测试押着旧形状，无产品 bug），见第 4 节
  第 4 条。
- 从 torch 线移植 ghost row（第 7 节）。

> 那一轮当时的记录：serve 1483 过 / 31 skip，frontend-next 934 文件 / 6911 测试全过；
> 改动提交在 `work/studio-session-20261121`（**该分支已删除**，改动均已进 `studio`）；
> 未纳入的是本地 pnpm 11 造成的 lockfile 漂移与它生成的
> `desktop/electron/pnpm-workspace.yaml` 占位文件（现已无漂移）。

2026-11-23 追加一轮：卡顿排查与修复（第 8 节，`156561e9c`），以及打包版本号
教训（§3.1 命令块已更正——版本必须在 `--dir` 步注入，`--prepackaged` 补不了；
host 用 `REASONIX_VERSION`）。

2026-11-24 追加一轮（第 9 节，基线 `7a2b52db8`）：**会话互聊收尾**——Hops 防环、
PeerView 元数据、refuse 语义三项落地，对齐 MiMo；以及**审批链路五个缺陷**的修复，
根因是 `dispatch.same_project` 的前置检查与它所管的审批卡互相依赖（死循环，重启才
暴露）。同轮新增 `make check-fast`。真机验证：同项目 dispatch 闭环跑通。

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

**安装包文件名必须带版本号**（`ReasonixStudio-windows-amd64-<版本>-installer.exe`）。

- `electron-builder.yml` 的默认 `artifactName` 没有版本；发布工作流
  （release-fork.yml:113-114）靠 `-c.nsis.artifactName` / `-c.win.artifactName`
  覆盖补上，本地命令漏了这个覆盖就产出无版本名的安装包。
- 2026-11-23 又踩了一次：2.67.0 的包先是 `ReasonixStudio-windows-amd64-installer.exe`，
  靠手工改名补救。

结论：**不是 NSIS 的锅**。`electron-builder.yml` 的 nsis+zip 目标从 2.62 之前就在，本地
`--dir` 也一直是 7 秒级；安装包本身只多 3 分钟。真正能把一次构建拖到十几分钟的是：

- **Electron 每次重新联网。** 不传 `-c.electronDist` 时，electron-builder 会走
  `@electron/get`。
- 它每次构建都要重新拉 `SHASUMS256.txt`（`cacheMode: Bypass`，见
  `app-builder-lib/out/util/electronGet.js` 的注释），所以即使 158MB 的
  `electron-v45.2.3-win32-x64.zip` 已在缓存里仍要联网。
- 本机当前 34s 后报 `unable to get local issuer certificate`；网络慢时就是 2.62
  交接里记的「卡十分钟」。
- **修法（2026-11-23 实测）**：`NODE_USE_SYSTEM_CA=1`。这台机器到 GitHub 的 TLS
  链路带了一个 Node 自带 CA 包不认的证书链，curl 走 Windows 系统证书库所以一直
  成功，Node 默认 CA 包必失败；让 Node 信任系统证书库后 `fetch` 即 200。
- `build:host` 的驱动下载与 electron-builder 的工具集下载由此直接走通，交接文档
  旧版的「手动搬驱动到 bin/」与「工具集镜像」两个规避步骤都不再需要。
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
   - **2026-11-26 定位：不是挂死，是串行求和。** `-timeout 20m` 跑完整包退出码 0、
     全绿 749s；1921 个测试里最慢的只有 13.2 秒，**没有一个超过 30 秒**。1713 个
     测试各 0.14s 的平均值加起来就是 235s，198 个 1–5s 的再加 470s。此前
     `stats.dispatcherFor` 的 goroutine 栈只是超时那一刻的快照，不是原因（那个泄漏
     另见下条，已修）。
   - **已加本地分片 `make test-serve`**：按 CI `test-windows-shards` 同一套
     `-run`/`-skip` 拆三片并行，实测 5m8s（259s / 304s / 185s）。三片用集合运算
     验证过：`^Test[A-E]` ∪ `^Test[F-R]` 与 `^Test[A-R]` 完全相同（1065 个）且零
     重叠，第三片补足其余 459 个，1524 个测试无重复无遗漏。
   - **`go test ./...` 本身没有变快**，这是有意保留的。`-p 20` 是包之间并行，
     整包耗时约等于最慢那个包——就是 serve 的 ~703s。要让整包变快只能把 serve 从
     `./...` 里摘出去，那会让「整包」不再等于全量，本轮没做。
   - `stats` 的 goroutine 泄漏已修：`recorderDispatchers.byDir` 是永不清理的全局
     map，`CloseUsageCatalogs` 现在先停全部 dispatcher 再关 catalog。
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
6. ~~已提交到 `work/studio-session-20261121`~~ **该分支已删除**，改动均已进
   `studio`（第 5 节与第 5.1 节是当时那一轮的清单）。
7. **`testenv.TempDir` 的失败仍然静默**（2026-11-26 记录，未修）。`tempdir.go` 在
   100 次重试耗尽后只 `t.Logf` 一行，不失败也不重试更多次；磁盘上 1772 个
   `reasonix-test-*` 就是这样堆起来的（第 15.5 节）。改成可观测事件牵动「记录但不
   失败」这个既有取舍，留给下一轮判断。
8. **其余 TestMain 未加 `GO_WANT_HELPER_PROCESS` 门控**（卫生项，非主因）。11 个走
   `RunWithIsolatedUserState` 的包里只有 `internal/ext/plugin` 做了门控；boot 只门控了
   `fakeComputerHelperEnv`。2026-11-26 实测该路径下子进程会自行清理（嵌套内层为 0），
   所以它不解释残留，只是让子进程多分配一个 home 再删掉。

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

## 9. 会话互聊收尾（PR2/PR4/PR5）+ 审批链路五轮修复（2026-11-24）

**基线**：`7f3b15bb2` → `7a2b52db8`，18 个提交。详细评估见桌面
`会话互聊-评估与交接报告.md`（第三版），本节只记与仓库相关的硬事实。

### 9.1 功能三项（对齐 MiMo）

| 提交 | 内容 |
| --- | --- |
| `f56990695` | **Hops 防环**：`peermail.MaxHops=8` 导出 + `ErrHopLimit`。语义＝**链深度**：无 `reply_to` 从 0 起，指名回信 `被答 hop+1`，超限 `peer.hop_limit`（HTTP 409）。入站 hop 随 inbox 信封 `peerExtraHops` 保留，批准后仍可续链 |
| `80bb44982` | **PeerView 元数据**：`Busy`/`Purpose` 走 live record（读方无法调用对方 `Controller.Running()`），读取侧再归约；`list_peers` 加 `busy`/`role=` 两列 |
| `d4404d519` | **refuse 语义**：`incoming="never"` 是第四答案 → 发布 `Inbound:"refuse"` → `ErrPeerRefused` 可达；`never` **优先于** `release_projects`；拒收 ≠ 拒答 |

### 9.2 审批链路：五个缺陷（`ef48cd756` … `7a2b52db8`）

这一串是因为"点全部放行后 agent 不动"排查出来的，根因逐层剥开：

1. `select` 里答案与取消同时就绪时随机选一个 → 取消分支再查一次 `reply`。
2. `grantSession` 只在工具侧调用，turn 死了授权不落库 → 移到 `Approve()`；
   **setting 必须豁免**（它自己按偏好存授权，否则一个 yes 短路所有设置卡）。
3. 前端无条件标记 `__decided` → 卡片假消失而内核仍在等 → 只标记 `drained` 里的卡。
4. `postAckedJson` 丢了 `postAcked` 的 20s 超时 → 按钮永挂 → 补齐超时与类型化错误。
5. **`dispatch.same_project` 前置检查是死循环** → 取消。

**第 5 条是最隐蔽的**：

```go
// internal/frontend/serve/dispatch.go（改前）
if own && !sender.DispatchIntoSelfAllowed() {
    return control.DispatchResult{}, projectError(control.ErrDispatchSameProject, root)
}
```

`DispatchIntoSelfAllowed()` 读的授权，唯一来源就是这道检查挡住的那张审批卡。
新会话无授权 → 直接拒、卡都不弹；之前偶尔能弹是因为内存里有旧授权；重启清空后必撞。

**改法**：删掉前置检查，同项目与跨项目一样先弹卡、用户点了就发。
`DispatchIntoSelfAllowed()` 随之成为死代码，已删（`7a2b52db8`）；
`ErrDispatchSameProject` 与 `dispatch.same_project` 的映射保留（sentinel 仍有语义）。

### 9.3 「确认全部放行」的语义（`f4668e6c8`）

一个决定、两件事：切到 yolo（`POST /tool-approval-mode` → `{"drained":[...]}`），
**并且**当前这张卡走普通审批 `approve(id,"once")` 结算。

内核「fresh 卡不被模式切换代为放行」的规则没有破坏——它仍是一次显式 `allow_once`。
`SetToolApprovalMode` 现在**返回** `[]string`（drained ids），端口只此一个方法，
避免 `frontend-parity` 因"加了方法前端没驱动"而失败。

### 9.4 真机验证（2026-11-24 00:12）

同项目 dispatch → 子会话 `s-68c816ec6f786468` 执行 `git rev-parse --short HEAD`
→ 回信 `m-f24d23f1df1f5fad`（394 B）→ 因 `RS build` 在 `release_projects` 自动投递。
审计四步完整：`released` → `sent` → `held` → `released(consent:project)`。
子会话回信**引用了原话**，证明 `reply_to` 关联生效。

### 9.5 新增门禁 `make check-fast`（`12c140d26`）

**按测试名收窄，不是按包**。实测（本机 20 核 NVMe）：

| 方式 | 耗时 |
| --- | --- |
| `session/control` 整包 | 107 s |
| 一次改动对应的测试集合 | **5.8 s** |
| `repolint` 全树 | 12.7 s |
| `repolint -changed` | 20.5 s ← **比全树慢**（git 调用 + 全树解析） |
| 预编译 repolint | 14.2 s ← **不比 `go run` 快** |

选择规则：改动文件名与测试文件**同名 feature**（第一个 `_` 前的词，单复数归一）。
一个 feature 的测试本身可能贵（`serve` 的 dispatch 测试每个起真 Hub，~40 s），
脚本在改动超 4 个包时提示改用 `make check`。

### 9.6 打包（本轮更新）

```bash
cd desktop/frontend-next && pnpm build           # 前端
cd ../electron && node packaging/build-host.js   # kernel ← 最容易漏
./node_modules/.bin/electron-builder --win nsis -c.electronDist=node_modules/electron/dist
```

- `pnpm build:dist` 会因 `ERR_PNPM_IGNORED_BUILDS`（electron-winstaller）失败，
  直接调 `electron-builder` 绕过。
- **只跑 `electron-builder` 不重建 host → 装上去的是旧 kernel**。
- 产物名被 hook 改成 `ReasonixStudio-windows-amd64-installer.exe`（不是 x64）。
- 跑 `pnpm` 会改写 `pnpm-lock.yaml`，提交前 `git checkout --` 还原。

### 9.7 其它修复

- `ec2b4e834` 弹窗根治：测试 sleeper 从 `Start-Process`（**会分配新控制台**，
  Windows Terminal 下 `-WindowStyle Hidden` 挡不住）改为
  `CreateProcessW(bInheritHandles=false, CREATE_NO_WINDOW)`。
  中间试过 `Process.Start(CreateNoWindow)`，它不分配控制台但**继承父管道**，
  导致 `WaitDelay` 超时——两者只能靠 Win32 一次满足。
- `ff15945ae` 审批卡中文文案：`EXPLICIT_APPROVAL` 表漏了 `peer_message`/`dispatch_task`，
  卡片回落到英文原文。
- `69174eb49` `docs/TOOL_CONTRACT.md` 的 `browser_read` 漂移（`7cc95881d` 带入）。

### 9.8 教训（写进纪律）

1. **改一层时读完相邻代码的全部职责。** 本轮三次翻车都源于此：
   换掉 `postAcked` 时丢了它的超时；给 setting 记授权时没注意它自己的一套；
   修"卡片假消失"时没走一遍"用户点完看到什么"。
2. **UI 问题先把交互路径完整读一遍再下结论。** 前四轮都在猜现象背后的层，
   用户一句"你拿不到我批准的状态"才指到根因。
3. **前置检查与它所管的审批卡不能互相依赖**——那是个死循环，而且被内存残留掩盖，
   只有重启才暴露。

## 10. 人自己派发任务 + 工具描述纠错（2026-11-24，`1201fa9d7`）

**基线**：`7b57ac4d6` → `1201fa9d7`，1 个提交，23 文件。发版 **2.68.0**。

### 10.1 P3-b：直接把任务交给另一个项目

此前只有模型能发起 dispatch，人手里已经想好的任务还得写成请求让模型转交。
现在设置页「会话互聊」多一块「直接派一个任务」：选项目、写任务、可选填角色，
按下即发出。

三层齐全，缺一层都跑不通：

| 层 | 落点 |
| --- | --- |
| HTTP | `serve/peers.go` 新增 `POST /dispatch` + `startDispatch`；`refuseDispatch` 是工具侧 `peerErrorCode()` 的 HTTP 孪生，11 个 dispatch 码各自带码 |
| 接口 | `control/port.go` 的 `PeerMail` 加 `DispatchToProject`，`SessionAPI` 自动继承 |
| 前端 | `port.ts` 契约 + `sse_boundary.ts` 真实实现 + `mock_boundary.ts` 桩；`ui/PeerDispatch.tsx` 挂进 `PeersSection` 的新 Group |

**审批语义（用户拍板）**：人发起免卡。按下控件就是他本人对那张卡的答复，
所以不再出卡；此后一切照旧——项目解析、信任问答、`cross_project`、
两个 ceiling 全部仍然生效。卡只挂在工具路径上（`subjectSensitiveTools`），
REST 走 `s.Controller().DispatchToProject`，天然绕过卡而保留其余全部检查。

### 10.2 工具描述与实现相反（本轮最要紧的一处）

`peers_dispatch.go:21` 对模型宣称：

> *"Without a role, one task per project is the rule, and **this session's own
> project is refused**."*

而 `serve/dispatch.go:137-139` 的实现和 `TestADispatchToTheSendersOwnProjectOpensASession`
都表明同项目**允许**，由审批卡把关。`843ce4498` 取消前置检查时只改了
`dispatch.go` 和测试，**漏掉了这句模型可见的描述**。

后果不是文案问题：模型读到这条规则就**不会去尝试**同项目 dispatch，
一个已经实现好的能力对它隐形。

已改为 *"this session's own project is allowed like any other, with the
dispatch card as the yes"*，并按
`REASONIX_UPDATE_GOLDEN=1 go test ./internal/assembly/boot/ -run Golden`
重生成三个 golden。diff 复核：只有该句 + `ToolsHash`/`PrefixHash`，
`ToolSchemaTokens` 5372 → 5383（+11）。

### 10.3 门禁挡下的三件事

1. **`port.ts` 原本正好 800 行**，正是 `maxFileLines` 上限；加 3 行即超。
   按仓库规矩「不放宽基线」压回 800：合并两行相邻的短 `export type`、
   删掉与方法实现重复的那行注释。`repolint` 的 message 会直接说
   `file-size is 3 over its 0 budget`。
2. **`TestEveryRefusalCodeIsTranslated`** 拦下 11 个新 dispatch 码——每个 refusal
   码都必须在前端 `kernel.ts` 有译名，这是 `refusal-path` 的另一半。
3. **一个真 bug，只有浏览器实测才看得见**：`PeerDispatch` 最初自己调
   `usePeersSettings(port)`，与 `PeersSection` 各持一份状态，打开开关后表单不出现。
   改成按 `settings` 传入 store（照 `PeerProjects` 的做法）。单测里 mock 了
   settings 所以抓不到——这条记进 10.5。

### 10.4 顺带修掉的两处

- **census 上限 215 → 214**：实测未命名输入 214，注释原文要求
  *"lower it the moment any drop"*。这 214 个是遍布全产品的旧形式遗留
  （`Remotes.tsx` 14、`Workspaces.tsx` 9、`PaneTabs.tsx` 9…），
  注释说明 213→215 那次是**仪器修正**（认证 primitive 回调把 Picker 调用点
  纳入统计），不是债务增加。
- **两处注释漂移**：`internal/contract/tool/peer.go` 与
  `internal/session/control/peer_dispatch.go` 原写 "another of the user's
  projects"，改为 "one of the user's projects, its own included"。

### 10.5 `check-fast` 的两处修正

- `--print-plan` 原印 `frontend typecheck over: <文件列表>`，而真实执行的是
  `pnpm typecheck`（`tsc --noEmit` **全树**）。现在印
  `frontend typecheck (whole project) — N frontend file(s) changed`，
  说清运行范围与触发原因的区别。
- `check-fast.test.mjs` 里「按 feature 选测试」那条**自提交起就只在脏工作树
  成立**（`--base HEAD` + 假设 peer 文件本次有改动），一提交必然失效。
  改用历史基线 `f56990695~1`，干净树上也能验证同一条规则。

### 10.6 验证

- `check-fast` 端到端绿：`repolint: clean (2332 baselined findings)`、
  `contract/tool` / `frontend/serve` / `session/control`（23.6s）/
  `tools/builtin` 全 ok、`pnpm typecheck` 通过。
- 前端 42 条：派发交互 7、设置页 4、census 21、设置目录 10。
- 浏览器实测（dev + MockPort）：打开两个开关后表单渲染出项目下拉 / 任务 /
  角色 / 「派过去」；填内容按钮激活；点击返回
  「已经派到「DeepSeek-Reasonix」的「reviewer」角色」并清空输入。

### 10.7 打包 2.68.0（含一个新坑）

按 §3.1 三步走，版本两处都核过：`app.asar` 内 `package.json` = **2.68.0**，
`reasonix-studio-host.exe` 二进制命中 3 处 2.68.0。

**新坑**：NSIS 第一次失败，`reasonix-studio-electron-2.68.0-x64.nsis.7z`
报 `Cannot open the file as [7z] archive` / `Is not archive`。

原因是先在前台跑了一次 electron-builder，撞上宿主 2 分钟上限被杀，
**留下半成品 `.nsis.7z`**，后台那次接着在损坏文件上继续。
**删掉 `.nsis.7z` 重跑即可**。教训与 §3.1 的「只跑 electron-builder
不重建 host」同类：中间产物被中断后不会自愈。

**文件名**：`-c.nsis.artifactName` 先产出 `...-x64-...`，随后
`afterAllArtifactBuild: canonical-artifact-names.js` 重命名成 `...-amd64-...`。
所以最终名里的 `amd64` 是 hook 给的，与 §9.6 记录一致：

```
dist/ReasonixStudio-windows-amd64-2.68.0-installer.exe  140,965,951 B
sha256 33d69457916c03ff626edfb2c6181a9f95e10893e5c8aeaa6abaf2066ebb1400
```

PE32 / NSIS self-extracting，未签名（首次运行按系统提示放行）。

### 10.8 剩余

- **P3-a** 审计导出：`peermail.AuditRecord` 字段齐全（`At/Receiver/Sender/ID/
  Decision/Reason/Consent/Bytes/SHA256`）、`AuditSince()` 已存在，但只被
  `peer_threads.go` 与 `peer_mail_send.go` 内部调用，**没有 HTTP 出口**。
  补一个 `GET /peers/audit` + 只读表格即可。
- **P3-c** dispatch 指定 profile：`OpenRequest` 现只有 `Model`。
- **P3-d** 外部 agent：ACP 目前只有 agent 方向（`reasonix acp` 被编辑器启动），
  client 方向全树没有。
- **§8 折叠卡顿 B1/B2**：待用户拍板方案。
- **`Workspaces.tsx` 1157 行**抽取：仍是 UI 每次改动最费劲处。

## 11. 首次推送与 CI 修复（2026-11-24，`a1e2249f7`）

30 个提交推到 `origin/studio` 后，CI 七红。七处最后归到**五个根因**，全是这次推送
之前就在的东西，只有一处是真正的回归。记下来是因为其中三条的排查方向都先猜错了。

### 11.1 五个根因

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| `TestServeEndpoints` 204 vs 200 | `f4668e6c8` 让 `POST /tool-approval-mode` 返回 `{drained:[...]}`，测试仍断言 204 | 改断言 200 并校验 `drained` 存在 |
| `TestEveryRouteReachesTheDevServer` | 新增 `POST /dispatch` 没进 `vite.config.ts` 的 `ROUTES` | 加 `"/dispatch"` |
| `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | `21192a3b6` 顺手带走了 `pnpm-lock.yaml` 的 `overrides` 段 | 整份回到漂移前版本 |
| `TestCheckProviderDecisionSourceUnreachable` | `srv.Close()` 释放端口，同轮别的测试抢到，探针打到别人的 mux 得 405 | 指向 `127.0.0.1:1`（永不监听） |
| `peers-section` 找到两个相同文案 | 新派发区块复用了项目区块的「先启用会话间消息」 | 派发区块用自己的话 |

`lint` 那一轮还独立抓到 `approval_cancel_race_test.go` 的 `context.Background()`
该换 `t.Context()`——`go vet` 看不出来，只有按 CI 版本跑 golangci 才有。

### 11.2 hop 测试：修了两次才对

`TestAMessageAtTheHopLimitIsNotSentAgain` 在 Windows CI 上偶发，本地 30 次复现不了。

**第一次判断错了**：以为 spool 写入还没被 `Pending` 看到，加了「等 held 出现」的
轮询助手。结果 **CI 变成稳定失败**，耗时 3.25s——正好是助手的 3 秒超时。

**第二次才查清**：这条消息根本没有进 held。`pairedWith(t, true)` 把它标成 dispatch
配对，`releaseHeldPeerMessages` 于是**放行**它，hop 存进 inbox envelope；
`peerMessageHops` 走兜底路径去读 envelope。这条路依赖机器上 `peers.incoming` 的答案，
而测试从没固定过它——**测的是配置，不是上限**。

改法：显式 `setPeerIncoming(t, config.IncomingAsk)`，让消息留在 held，hop 立即可读。
运行时间 3.2s → 0.25s（不再轮询），这才是修好的证据。

顺序有个坑：`setPeerIncoming` 依赖 `REASONIX_HOME`，而这由 `newPeerFixture` 内部的
`setDispatchSwitch` 设置，所以**必须放在 fixture 之后**，否则会写进真实用户配置。

### 11.3 `pnpm census`：一个被改出来的既有缺口

`UNDECLARED_MUTATION = 1`：`CapabilityScope.tsx:158` 的 `ScopePicker` 选项没有 action 名。

**它不是新代码**——那个按钮 11-13 就存在。变的是 census 现在**能跟到**这条写入了：
`Settings.tsx` 里把 `setApprovalMode` 包进 `async` 箭头函数（为拿 `drained`），
给 effect 联结多了一条边，于是这个根从"只读"变成"已证明会写"。

修法：给按钮加 `data-action="ext.scope-pick"`，`actions.ts` 注册为 `kernel-mutation`。

教训：**instrumentation 变强会暴露既有债务**。这和 census 注释里写的 213→215 是同一类
事件——数字变了不等于债务新增。

### 11.4 剩下两项（2026-11-26 已修）

- **`govulncheck`**：`gorilla/websocket` 升到建议里的 commit 伪版本
  `v1.5.4-0.20240701034025-d67f41855da4`（该 commit 的内容就是这处修复）。本机
  `govulncheck ./...` 报 0，`browser` / `remotecloud` 包测试通过。
- **`browser guards`**：8 处对比度不足全在 `Notifications.tsx` 的关闭态从属行。
  根因是整行 `opacity: .5` 把正文和底一起稀释；改为只把标签降到 `--muted`，
  开关自身的 disabled 已经说明状态。`perf/contrast.mjs` 在浅/深 × soft/unset
  全绿，`settings-disabled.test.ts` 押住这条规则。

### 11.5 macOS 三个 job 被取消

`test (macos-15)` / `sdk (macos-15)` / `desktop-macos` 全部 `cancelled`：runner 排队
超时，与代码无关。免费额度下这一轮的 job 调度普遍偏慢（run 级状态长时间停在
`pending`，而 job 级其实已在跑——**查 CI 进度要看 job 级**）。

## 12. 会话互聊：全放行代答 + 投递时机（2026-11-24）

用户用了上一轮的互聊功能后报了两件事：点了「完全放行」之后互相发消息**仍然每次弹卡**；
以及 A 会话跑任务时收到 B 的消息，**要等整个任务结束才看到**，造成两边对进度的认知
不同步。两条都不是 bug，是当初的设计取舍写反了预期。

### 12.1 全放行为什么还在出卡

`approval.go` 的 `requiredHumanAnsweredLocked` 一遇 `requiresFreshApprovalTool(tool)`
就直接返回 `false`，而 `RequiresFreshHumanApprovalTool`（同文件）把
`SendPeerMessage` / `DispatchToProject` 列在那个集合里——设计意图是「yolo 不代你说话」，
卡片文案也写死了 *"Auto, YOLO and remembered answers do not answer it"*。

**修法（`postureAnswersTool`）**：只对 YOLO 档位放行这两个工具。关键分层是——

- 交互式会话走 `approvalManager`，改动在这里生效。
- **headless 走的是 `permission.NewGate(policy, nil)`**，`Approver == nil` 时由
  `permission.unattendedAsk` 拒绝，根本不经过 `approvalManager`。
- 所以 `permission.subjectSensitiveTools` 里那两个条目**原样保留**，无人值守仍然
  `RefusalUnattended`。这是本次能被安全放宽的唯一原因，别把它们从 `Policy` 层移走。

`drainLocked` 同步放宽：切到全放行时，已弹出的 peer 卡一并结算（否则卡会留在屏幕上，
用户会以为切换没生效）。`approval_bridge.go` 与前端 `chat.ts` 的卡片文案改为
*"Auto and remembered answers do not answer it; full access does"*。

### 12.2 消息为什么等到 turn 结束

`resolvePeerMessage` 用的是 `IntentFollowup`，而 `startPeerItem` 只在
`!c.Running()` 时才启动队列——跑着的会话只入队，等这一轮跑完才取。

**修法**：`c.Running()` 为真时先试 `steerInboxItem(id, true)`，被接受
（`DispositionSteerAccepted`）就是中途注入。三个条件都会回退到 `startPeerItem`：

- 队列处于暂停；
- 会话正在轮转；
- 在 `Running()` 检查与 steer 调用之间 turn 已经结束。

注入走的是用户插话同一条通道（`SteerPeerItem` 那一套），所以固有边界照旧：消息在
**下一个 provider 请求**被消费，不是立刻打断。模型正在跑一条长命令时仍要等那条命令
结束，但不再等整个任务。

### 12.3 三态来源：模型必须知道是谁在说话

原来 steer 只有 `host bool` 两态。peer 消息借这条通道进来后，如果不加区分，模型会把它
读成「host 运行时自己的提醒」（`HostNoticePrefix` 明说 *the user did not send this*），
和「另一个会话发来的数据」是两回事。

`sessionstore` 新增 `PeerNoticePrefix` 与 `SteerSource`（`SteerByUser` / `SteerByHost` /
`SteerByPeer`）+ `SteerSourceOf`。`steerEntry.host` 换成 `source`；新增
`Agent.SteerPeerItem`；`steerItemAs` 按 `InboxItemMeta.Source` 的 `peer:` 前缀分流。

**连带修掉一处自己引入的退化**：peer 消息落进对话后 `HostAuthored=false`，而
`history.go` 用 `SteerKind` 只回 `host` 布尔——重开会话时那条消息会被画成**用户自己
说的插话**。

三处呈现改用 `SteerSourceOf`：`serve/history.go`、`serve/history_page.go`、
`acp/dispatch.go`。`history.go` 保留记录并置 `HostAuthored: !byPerson`，不是直接
丢弃，因为 `TestHistoryDoesNotCreditTheHostsOwnSteerToThePerson` 押着这个形状。

顺手删掉两态 `MidTurnSteerMessage(text, host bool)`：它已是双轨 API，正是这轮要拆掉的
东西（`repolint` 的 orphan 规则也拦下了它——只剩测试引用）。所有调用点改走
`MidTurnSteerSource`。

### 12.4 验证

| 项 | 结果 |
| --- | --- |
| `go test ./internal/session/control/` | **ok 311.0s**（整包） |
| `go test ./internal/state/sessionstore/` | **ok 104.4s** |
| `go test ./internal/runtime/agent/` | 3 条失败，见下 |
| `go test ./internal/frontend/serve -run 'TestHistory\|TestHostAuthored\|TestPeer\|TestLocate'` | ok 2.6s |
| `go test ./internal/frontend/acp/` | ok 28.8s |
| `go test ./internal/assembly/boot -run TestEffectSendPeerMessage\|TestEffectDispatchToProject` | ok 7.9s |
| 前端 `gates` + `full-access-card` + `ApprovalCard` | 20 条全过 |
| `tsc --noEmit` / `go vet ./...` / `gofmt -l internal/` | 全部无输出 |
| `repolint -changed` | clean（2330 baselined） |

失败的 3 条是 `receipt_host_owned_test.go` 的符号链接用例，报错原文
`A required privilege is not held by the client`——本机没给创建 symlink 的特权，测试
自己就打印 *"this runner cannot create symlinks, so the protection is untested"*。
该文件本轮未改动。

`review` 与 `security_review` 都跑过（`approval.go` / `approval_bridge.go` 在
`REASONIX.md` 的 sensitive 清单里）：结论都是不阻塞发布，security 侧确认 headless
仍然拒绝、其余 fresh-human 决策未受影响、peer 正文的框架未被削弱。

### 12.5 教训

1. **一处放宽要问「另一个入口怎么走」**：交互式与 headless 是两条不同的 gate 构造
   路径，只看 `approvalManager` 会以为放宽覆盖了全部。
2. **改一条通道的语义，要跟着看它的呈现层**：peer 消息借 steer 进来，模型侧加了
   前缀就以为完事，实际上 `history.go` 还在按两态渲染，重开会话就会把别人的话算到
   用户头上。
3. **两态 API 与三态并存是债**：`MidTurnSteerMessage(text, bool)` 留着的唯一结果，
   是后来人传 `false` 想表达 peer 时写错。删掉比留着便宜。

## 13. 子代理转录混进会话列表（2026-11-24，`4da06df36`）

用户在自己工作区的会话列表里看到三个标题为「继续」的会话，ID 形如
`sa_20261124_115222_000000000_35529d6d4160`，问这是不是 bug。**是。**

那三个是本次会话调 `review` / `security-review` 产生的子代理转录，`meta.json` 里
`kind=skill`、`parentSession` 指向当前会话、`parentToolCallId` 就是那次工具调用。
它们本该只通过父会话访问，却作为独立会话出现在侧栏。

### 13.1 根因：过滤器只认旧命名

| 层 | 位置 | 事实 |
| --- | --- | --- |
| 生成 | `delegation/subagent_store.go` `newRef()` | `sa_<时间戳>_<hex>` |
| 落盘 | `<sessionDir>/subagents/<ref>.jsonl` | 现代布局，独立子树 |
| 扫描 | `sessionstore/session_order.go` `eachSessionDir` | `filepath.WalkDir` 递归进**所有**子目录 |
| 过滤 | `store/session.go` `IsSubagentTranscriptName` | 只认 `subagent-` 前缀（旧扁平命名） |

`IsSubagentTranscriptName` 的注释自己就写着 *"reports a flat legacy subagent
transcript, which the current layout keeps under a subagents/ tree instead"*——它管的是
旧命名，新布局的 `sa_` 它认不出，于是 `false`。

而调用点都指望它兜底：

- `serve/sessions_list.go`
- `serve/hub_tree_page.go`（两处）
- `sessionstore/auto_archive.go`
- `sessionstore/empty_session_gc.go`

**`branch.go` 的 `ListBranches` 连调都没调。**

探针实测（修复前）：

```
IsSubagentTranscriptName("sa_20261124_115222_….jsonl") = false
ListSessions leaked: …\subagents\sa_20261124_115222_….jsonl
```

### 13.2 修法：在扫描层排除，不靠名字

`eachSessionDir` 对 `subagentsTreeName` 返回 `fs.SkipDir`。这与
`migrate_passes.go` 里已有的 `if e.Name() == "subagents" { continue }` 一致。

**没有**改成让 `IsSubagentTranscriptName` 认 `sa_` 前缀，理由：那个函数名义上是
「扁平旧命名的识别器」，改它的语义会把两件事混在一起；而且让 walk 进入一个内容永远
不是会话的目录，下一次命名改变又会重开这个洞。一处 `SkipDir` 让四个调用点同时受益。

子代理目录名收进常量 `subagentsTreeName`，放在读那些记录的 `subagent_records.go` 里。

### 13.3 与互聊新建会话的区别（用户问的第二半）

两者在磁盘上本来就分得开，只是列表没收对：

- **子代理**：`sa_` 前缀 + `subagents/` 子树 + meta 有 `parentSession`。只对父会话
  有意义，不进列表。
- **互聊 dispatch 新建的会话**：正常 `2026…-<model>.jsonl`，在会话目录下。那是用户
  真拥有的独立会话，**该出现**。

### 13.4 验证与收尾

- 新增 `subagent_tree_test.go` 两条：walk 不进 `subagents/` 但仍进日期目录；
  `ListSessions` 只回用户自己的会话。先红后绿。
- `sessionstore` 整包 **ok 107.032s**；`serve`（列表/树/归档/分支）**ok 158.870s**；
  `repolint -changed` clean。
- 列表索引无需清理：`subagents/` 不再被扫，旧条目自然不输出；`saveListIndex` 见条目
  变少也会重写索引。
- 已存在的 `sa_` 文件留在磁盘上无害，可自行删除。
- **需要重启客户端**才能看到列表变干净。

## 14. 2.69.x 汇总发布 + 调用分组（2026-11-25 → 11-26，`ef3952f97`）

这一轮把 2.67.1 之后积攒的东西一次性发了出去，并在发布前修完 Studio 侧的分组与回归。

### 14.1 发布线的实际情况（下一轮先看这条）

**2.67.1 是最后一个正式发布的版本**；2.68 与 2.69.x 当初只打了 tag，没走发布流程。
2.69.3 因此是**手动汇总发布**，`release-notes/studio/2.69.3.md` 把 peer、工作台页签、
浏览器批注、分组展示连同 2.69.3 的收尾修复全部写进去，并明说「装本版即可补齐」。

当前 tag 与提交的位置：

| tag | 指向 | 说明 |
| --- | --- | --- |
| `z2.69.3` | `ef3952f97` | 等于 HEAD，只提供安装包，无便携版 |
| `studio-v2.69.2` | `91cca35a9` | 只打 tag，未发布 |
| `studio-v2.69.1` | `5ecafc8df` | 只打 tag，未发布 |

`studio` 与 `origin/studio` 已完全同步。另有 `oliver` / `torch` 两个远端，是**独立历史**
（无共同祖先，交接文档叫 `TORCH_HANDOFF.md`），本节的判断一律以 `origin` 线为准。

### 14.2 调用分组：住在渲染层，不在 item list

连续四次 `view_image` 原来是四张卡——四个图标、四个标题、四段耗时，换四行内容。
`ff0715cfc` 把**同一类的连续调用**收进一条 lane：图片读作「查看图片 N 张」，
命令读作「运行命令 N 条」。组内每一项保留自己原本卡上的东西：缩略图仍带路径、
点开是大图；命令行点开是完整命令与输出，仍能带到末尾。

**关键约束：分组在渲染层 `turnrows.callLanes`，不写进 item list。** 存储里仍然是一次
一次调用，怎么画是一个模块的事——这样实时与重开会话读到的转录是同一个形状。
下一轮若要改分组规则，改的是这个模块，不要往存储里加「组」的概念。

三条边界同时立住：只合并**已结束**的调用（失败的要显示退出码、运行中的是读者正在等的
那条、后台任务保留自己的状态入口）；单张图/单条命令不成组，不额外加标题；「执行过程」
不再因为遇到图片就无视折叠设置强行展开。

同批 `5ecafc8df` 把 shell 行从「裁到 96 字符的半句话」改成「运行了一条命令」——
原来的做法让 heredoc 读起来像断掉的句子，还看不出这次调用到底做了什么。只改展示文本，
行本身的折叠、耗时、状态都留着。

### 14.3 计时账本按 call id 键控，因为换会话会重挂载

`d1e65859e`：切换会话时 transcript 用新 key 重挂载，而计时表活在画出它的那张卡里，
一重画就归零——跑了半分钟的 wait 工具又显示「已运行 5 秒」，单独调用的停止按钮还会
消失十秒。

改成**模块级、按 call id 键控**的账本，这正是能活过重画的东西。所有读这个时钟的地方
都传 id：wait 提示、步骤耗时、成本位、停止按钮、子代理行、折叠组的标题。线上从未命名
过的调用按卡片自身寿命键控，不会丢读数。不足一秒不绘制，且这个门限放在 hook 里，
让所有读者给出同一个答案。

### 14.4 图片画在行旁，不画在调试面板里（含一次误判与回滚）

`8789ca825`：一张图曾是那次调用存在的唯一理由，于是旧实现为它自动展开整张卡，代价是
把调用 id、输入 JSON、结果回执一起摊开——那是出错时才读的东西，不是看图时读的。

- 图片最后落在那个面板底部，还缩进 31px。
- 现在图片画在 disclosure **外面**：行照常折叠，`ToolShots` / `ToolVideos` 挂在它下面，
  随时可见。
- 图片不再让任何行自己展开。

**紧接着的 `24fda1f8a` 判断错了，当天被 `d2829e67e` 回滚**。它以为「查看了一张图片, path」
这行与下方可见的图片是同一件事印了两遍，于是删掉整行。

- 实际被问的那行是图片**上面那条 bash 调用**的行，不是 `view_image` 自己的。
- 删掉之后，「看了哪个文件」这唯一的说明从屏幕上消失了。

教训：**动手删之前先确认那一行是哪次调用画的**，尤其当同一片区域里有多张卡片时。

### 14.5 其余修复

- `13fb649c8` **peer 消息留下可见痕迹**：放行或常设同意放行的消息现在发一条 Notice，
  人能看到是谁在说话，而不是转录默默改向。
  - Notice 带内核自带的显示「来自另一个会话：<发送者>」，走既有事件通路，没有前端需要
    新行类型。
  - 重开会话同样要看得到：`/history` 用 `peerSteer` 标记，桌面与 TUI 重建为同一条
    Notice，同时仍拒绝把它画成人自己说的话。
- `de444bb17` **窗口按钮被页签槽罩住**：停靠工作台的页签条被 portal 进窗标题栏的槽位，
  槽位跑到窗口右沿，把按钮宽度当内边距——padding box 仍属于标题栏提交的拖拽区域，且槽位
  画在按钮之上，于是那个角落每次点击都变成拖窗口。槽位现在停在按钮左沿，并减去同样的
  预留宽度。
- `75dce43e8` **通知关闭态对比度**：整行 `opacity: .5` 把标签和说明一起稀释到 AA 以下
  （各主题 2.08–4.39 对 4.5）。只把标签降到 `--muted`，其余保持全强度——旁边那个
  disabled 开关已经说明了状态。
- `76a5e517a` **两行溢出**：分组的披露曾是 flex 容器，展开一条命令把输出挤到内容宽度
  （2101px 对 677px 的卡），现在披露是 block、摘要承担 flex 行，输出按组宽换行并在内部
  横向滚动；四段式选择器保持 `flex: none` 时在窄设置行里按自身宽度溢出 43px，基类控件
  现在按行宽收缩并换行，不该收缩的地方已各自覆盖。
- `0e5345afb` **`gorilla/websocket` 改用 crypto/rand**：GO-2026-6278（弱 PRNG 生成
  WebSocket mask key）**没有已发布的修复**，`v1.5.3` 仍是最后一个 tag；公告点名
  `d67f41855da4`，该 commit 的全部内容就是这处修复，所以升到它的伪版本，而不是停在
  漏洞库判定为受影响的版本。`govulncheck ./...` 报 0。
- `4ed970c9b` **批次回归修复**：2.69.1/2.69.2 的说明按发布说明形状重写并换上正确的
  commit 引用；`Transcript.tsx` 的 `Row` 拆出去以守住 800 行；成功但无输出的命令仍把
  命令留在活动正文里；分组的命令保留自己的锚点与完整输出读回；后台启动仍是一行并指向
  它的任务入口。

### 14.6 serve 全套超时的真正原因：串行求和，不是挂死

`go test ./internal/frontend/serve/` 在 600s 处 `panic: test timed out`，但这不是
哪个测试卡住了。`-timeout 20m` 跑完整包 **退出码 0、全绿 749s**，1921 个测试里最慢
的只有 13.2 秒，**超过 30 秒的一个都没有**——749s 是它们串行相加的结果。

超时那一刻栈里的 `stats.dispatcherFor` 只是快照，不是原因。那个真问题（
`recorderDispatchers.byDir` 永不清理）已在本轮修掉，见第 16 节。

**CI 早就知道**：`ci.yml` 的 `test-windows-shards`（push-only）把 serve 按测试名切成
`^Test[A-E]` / `^Test[F-R]` / 其余三片，跑在不同 runner 上。`-p 4` 只并行包之间，
对单包无效，所以本机撞墙而 CI 不撞。

**本机现在的跑法**：`make test-serve`（三片并行，实测 5m8s）。注意
`go test ./...` **没有变快**——238 个包里最慢的就是 serve（~703s），这是有意保留的
取舍（见第 4 节第 3 条）。

## 15. 测试隔离 home 残留：根因是进程级 SQLite 目录（2026-11-26）

起因是一份溯源报告：`C:\Users\<user>\.reasonix-test-home-*` 下堆了 99 个目录、66 MB，
`%LOCALAPPDATA%\Temp\reasonix-test-*` 另有 1772 个。报告的机制是「cleanup 跑了，但
`RemoveAll` 撞上还没释放的句柄，错误被 `_ =` 吞掉」。**方向对，根因归错了**，两条建议
实测都无效，这条记下来是因为「重试」看起来太像答案。

### 15.1 为什么不是「句柄稍后才释放」

按报告的建议把 `home.go` 的 `_ = os.RemoveAll(home)` 换成 `tempdir.go` 那套
100 次 × 20ms 重试，跑 `TestBuildExtraPluginProbeKeepsSessionProcessAlive` 三次：

| | 耗时/次 | 残留 |
| --- | --- | --- |
| 原样（单次 `RemoveAll`） | 0.8s | 每次 +1 |
| 加 100 次×20ms 重试（累计 2s） | 3.4s | **仍然每次 +1** |

耗时涨了四倍，说明重试确实跑满并耗尽了 2 秒——然后仍然删不掉一个只含
`v1.sqlite{,-shm,-wal}` 的目录。另一方面，对残留目录事后 `rmtree` **立即成功**。
两句合起来的结论是：句柄不是「稍后释放」，而是**在 cleanup 那一刻由本进程持有，
进程退出后消失**。重试等的是一个不会在进程内发生的释放。

真正的持有着是进程级单例：

```go
// internal/state/history/indexed.go
var processHistoryCatalog indexedCatalogManager
```

SQLite 连接建在它上面，而 `IsolateUserState` 的 cleanup 从不关它。boot 包早已知道
这件事，`config_home_test.go` 里写着 *"Windows cannot remove a temporary REASONIX_HOME
while SQLite still owns it"*，那个包提供了 `closeBootTestHistoryCatalog` 在**单个测试**
层面关它——但 `TestMain` 层从来没有调用。

### 15.2 修法：cleanup 钩子，而不是让 testenv 认识 history

`testenv` 在分层上只依赖 `testscope`（`internal/base` 的叶子层），**不能**反向 import
`internal/state/history`。所以修复落在「调用方注册」这一侧：

- 新增 `internal/base/testenv/cleanup.go`，暴露
  `OnCleanup(fn func(context.Context) error)`。钩子在 `RemoveAll` **之前**、且每一个
  cleanup 都跑（不是消费一次），因此钩子必须容忍被调用两次。
- `home.go` 的 cleanup 变成：`runCleanupHooks()` → `restoreScope()` → `restore()` →
  `RemoveAll`。
- 钩子失败只写 stderr、不 fatal：它保护的目录随后照样会删，而那时已经没有 `*testing.T`
  可以 fail。

注册点两处：

| 包 | 注册内容 | 为什么这样写 |
| --- | --- | --- |
| `internal/assembly/boot` | 新建 `closeProcessCatalogs`（关 history + stats） | `clisession` 直接 import `boot`，boot 反向复用它**会成环**，必须自己实现 |
| `internal/frontend/serve` | 直接复用 `clisession.CloseUsageCatalogs()` | 依赖方向允许（`clisession` 不依赖 `serve`），生产侧已有这个统一入口 |

`config` / `acp` 经核实**不创建**进程级 catalog（`config` 那处 `stats` 只是注释里的词，
`acp` 的 `history` 是 session history 不是 catalog），未加钩子。

### 15.3 我自己引入又修掉的一个真 bug

第一版把 `runCleanupHooks()` 写在 `restore()` **之后**。那时 `HOME` / `USERPROFILE`
已经恢复成真实用户目录，而 `clisession.CloseUsageCatalogs()` 内部会
`stats.Flush(ctx, config.StatsDir())`——**会把测试数据 flush 进用户真实的 stats 目录**。

修正为钩子先于 `restore()`，并补了一条断言把顺序钉死：

```go
if envHome != home {
    t.Fatalf("HOME inside cleanup hook = %q, want the isolated home %q", envHome, home)
}
```

反向验证过：把顺序改回去，测试精确报
`HOME inside cleanup hook = "C:\Users\<user>"` 而失败。

### 15.4 验证

| 项 | 结果 |
| --- | --- |
| 修复前 boot 单测 ×3 | 稳定每次 +1 |
| 修复后 boot 单测 ×3 | 两侧残留 **0** |
| 修复后 boot 整包（399s） | 两侧残留 **0** |
| `internal/base/testenv` 测试 | 全过；移除 `runCleanupHooks()` 时前两条会红 |
| `gofmt -l internal/` / `go vet ./...` / `repolint` | 全部干净（2330 baselined） |
| `golangci-lint` v2.15.0（三个改动包） | 0 issues |

boot 整包另有 3 条失败，把本轮改动全部 stash 后**以完全相同的错误失败**，均非本轮引入：

- `TestCompositionLinkedExtensionResources` 与
  `TestEffectSessionScratchIsReachableByItsSpelling`：这台机器没有创建符号链接的特权
  （`A required privilege is not held by the client` / `os.LinkError`）。
- `TestBuildNoticesMissingAPIKey`：单跑是 PASS，属测试间干扰。

### 15.5 三类残留的成因，与报告分类的出入

清点 100 个残留目录的实际构成后，报告的「A 型 = history-search 三件套，80 个」不准确：

| 形态 | 数量 | 成因 |
| --- | --- | --- |
| 有 sqlite（含或不含 lock） | 41 | 15.1 的进程级 catalog |
| 只有 lock、无嵌套 | 42 | 多为**中断**（Ctrl-C / `-timeout` / IDE 停测试），cleanup 没跑 |
| 只有 lock、有嵌套内层 | 11 | 同上，内层由子进程建 |
| 其余 | 6 | 空目录 |

`*.lock` 在全部 15085 个残留文件里占 13722 个（91%），是 `config-edits-*` 与
`memory-store-locks/` 下的正常产物——**它们留在磁盘只说明目录没被删掉**，不说明锁机制有问题。

「内层成功清理、外层被中断」的解释也被推翻：19 个带嵌套的目录里 17 个内层是 **0 文件**，
而内层 mtime（12:24–12:28）早于外层（12:37）——内层**目录本身**同样没删掉，只是内容
删空了。子进程走 `os.Exit` 会跳过所有 defer，这是它自己的那半个洞。

### 15.6 教训

1. **「重试」不是万灵药**：它只解「短暂占用」，不解「本进程持续持有」。判断属于哪种，
   看两个事实就够——加重试后是否仍然残留，以及事后能否立即删除。
2. **顺序本身就是语义**：钩子写在 `restore()` 前后，一个写临时 home、一个写用户真实
   目录，而两者都能跑完、都能「成功」。这种 bug 只能靠断言运行时的环境值抓住。
3. **报告的分类不等于数据**：17 个内层 0 文件这个事实，直接推翻了「内层清理成功」的
   推断，而它比结论更容易核对。

## 16. serve 分片落地 + stats goroutine 泄漏（2026-11-26）

接着第 14.6 节。这一轮把「定位」变成了「可跑」，并修掉顺带查出的一个真泄漏。

### 16.1 分片：`make test-serve`

新增 `scripts/test-serve-shards.sh` 与 Makefile 目标，分片规则与 CI 的
`test-windows-shards` 逐字一致（`^Test[A-E]` / `^Test[F-R]` / 其余）。实测：

| 分片 | 耗时 |
| --- | --- |
| serve-1 `^Test[A-E]` | 259s |
| serve-2 `^Test[F-R]` | 304s |
| serve-3 其余 | 185s |
| **三片并行** | **5m8s** |

划分用集合运算验证，不只靠「跑通了」：`^Test[A-E]` ∪ `^Test[F-R]` 与 `^Test[A-R]`
完全相同（1065 个）且零重叠，第三片补足其余 459 个，1524 个测试无重复无遗漏。

**脚本拒绝 `-run` / `-skip` 参数**：Go 只取最后一个，传进去会顶掉分片自己的划分，
三片同时变成「no tests to run」。这条是冒烟时真踩到的，不是预防性设计。

**整包 `go test ./...` 没有变快，且这是有意的。** 238 个包里最慢的就是 serve
（单跑实测 703s），`-p 20` 只并行包之间。要让整包变快只能把 serve 从 `./...` 摘出去，
那会让「整包」不再等于全量——本轮决定保留原样。

### 16.2 stats 的 goroutine 泄漏

`recorderDispatchers.byDir` 是按状态目录键控的进程级 map，`dispatcherFor` 每遇到新
目录就 `go dispatcher.run()`，而 `CloseUsageCatalogs` 只清 `usageManagers.byDir`，
**从不碰它**。一个走几百个 home 的测试二进制就留下几百个 goroutine。

修法：

- `recordDispatcher` 加 `stop()`：`close(queue)` 让 `for range` 自然结束，队列里已
  接受的记录**仍然写完**，然后 `<-done` 等 goroutine 退出。
- `CloseUsageCatalogs` 先 `stopRecordDispatchers()`（清 map 并逐个 stop），**再**关
  catalog。顺序有理由：append 会喂给 catalog，先关 catalog 会丢写。
- `enqueue` 在 closed 时直接丢弃、`flush` 返回 nil、`stop` 幂等——关闭后不会有 panic。

### 16.3 测试里两次自我修正

1. **假设全局独占**：`waitForDispatchers(t, 0)` 单跑通过、跑整包失败
   （`tracked = 4, want 0`），因为包内另有 19 处 `NewRecorder` 留下 dispatcher。
   改成每个用例先 `drainDispatchers` 清场，再断言自己创建的对象。
2. **注释超预算**：`CloseUsageCatalogs` 的注释写到 9 行，repolint 按 5 行上限拦下。
   压缩而不是 `-update` 放宽。

反向验证做了两次：禁用 `stopRecordDispatchers()` 后 4 个用例全红
（`tracked = 6, want 0`），恢复后整包 ok。

### 16.4 一个容易记错的对应关系

| 想跑什么 | 用哪个 |
| --- | --- |
| 只验证 serve | `make test-serve`（5m8s） |
| 全量（含 serve，慢） | `make test` / `go test ./...`（~703s+） |
| 单跑某个 serve 测试 | 直接 `go test ./internal/frontend/serve/ -run X` |
