---
owner: @esengine
backup: @SivanCola
status: active
reviewed: 2026-11-28
---

# Reasonix Studio 左栏 / 右工作台开合掉帧：复现与根因

> 只读诊断，未改动源码。日期：2026-11-27。
> 复现环境：`desktop/frontend-next` 的 perf 台（Chromium，`perf.html`），CPU 4x/1x 降频，mock 长会话；另读 Electron 壳、prefs、进程与历史记录。

## 0. 结论

**复现成功。掉帧的主因不是布局，而是整棵 DOM 的样式重算。**

一句话根因：

> `.app` 上的 `data-rail` 翻转会触发一次全子树样式失效，而 `--rail-w` 是被 `@property` 注册为**可继承**、又由 CSS transition 逐帧插值的属性；动画期间每一帧都让整棵子树重新计算样式。会话越长，DOM 占位块越多，这笔重算越贵；新会话几乎没有可重算的内容。
>
> 右工作台的 `data-browser` 翻转是同一机制，另加 View Transition 快照与 Electron 原生 `WebContentsView` 的逐次 `setBounds`/遮挡探测。

**我先前列出的「grid 轨道逐帧重排」假设被测量否定**：`.flow` 宽度恒为 760px，文本从不折行；Layout 全程平坦（CPU=1 每次 toggle 5.5–6.5ms），固定 grid 列、`transition:none`、scene 窄布局都救不了帧时间。**「安卓走 scene 抽屉所以不卡」也被否定**：600px 下 grid rail 列确实固定为 0，但成本不变。

---

## 1. 复现数据

方法：`http://127.0.0.1:4399/perf.html?panes=1`，用 `perf/rail-toggle-panes.mjs` 的 `window.__feed` 序列 seed 轮次；每次 Ctrl+B 后用 rAF 采集 450ms 帧间隔，CDP `Performance.getMetrics` 取 Layout/RecalcStyle/Script 增量；每组全新 context/page，6 次 toggle。临时脚本在 `%TEMP%\rail-probe\`，未写入仓库。

### 1.1 主表

| TURNS | CPU | p50 (ms) | p95 (ms) | worst (ms) | >50ms 帧 | 每 toggle 帧数 | Layout/toggle | RecalcStyle/toggle | nodes |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 1 | 16.7 | 17.7 | 39.7 | 0 | ~28.7 | 5.5 | 127.8 | 1,171 |
| 20 | 1 | 16.6 | 18.8 | 24.3 | 0 | ~28.3 | 6.0 | 136.9 | 2,644 |
| 60 | 1 | 16.7 | 18.5 | 33.7 | 0 | ~28.2 | 5.9 | 150.5 | 5,604 |
| 150 | 1 | 21.5 | 64.4 | 96.8 | 6 | ~20.0 | 6.0 | 186.1 | 12,264 |
| 400 | 1 | 47.7 | 159.4 | 206.2 | 19 | ~9.0 | 6.5 | 216.8 | 30,764 |
| 0 | 4 | 54.3 | 78.7 | 105.5 | 34 | ~11.0 | 10.9 | 318.6 | 1,171 |
| 20 | 4 | 76.2 | 123.3 | 130.5 | 32 | ~7.5 | 10.7 | 359.3 | 2,644 |
| 60 | 4 | 90.3 | 230.8 | 345.2 | 21 | ~5.7 | 10.2 | 382.7 | 5,604 |
| 150 | 4 | 132.6 | 561.8 | 561.8 | 12 | ~2.7 | 12.7 | 465.8 | 12,264 |
| 400 | 4 | 1031.2 | 1291.9 | 1291.9 | 6 | ~1.2 | 35.2 | 1023.2 | 30,764 |

注意：CPU=4、TURNS≥150 时每个 450ms 窗口只渲染 1–3 帧，p50 实际是「阻塞帧的长度」；`worst=1291ms` 表示单帧超过 1.2 秒。`frames`/每 toggle 帧数必须和 p50 一起看。

**趋势**：CPU=1 的 p50 从 16.7ms（0 轮）涨到 47.7ms（400 轮）；CPU=4 从 54ms 涨到 1031ms，150 轮是拐点，400 轮崩塌。RecalcStyle 从 127.8ms/toggle 涨到 216.8ms（CPU=1），Layout 基本不动。

### 1.2 一次折叠的 tracing（TURNS=150, CPU=4, 450ms 窗口）

| rep | wall | Layout | UpdateLayoutTree | Paint | PrePaint | Raster | rAF 回调 |
|---|---|---|---|---|---|---|---|
| 0 | 489ms | 12.5ms / 2 | 362.6ms / 2 | 24.4ms / 8 | 20.7 / 3 | 4.8 / 36 | 2 |
| 1 | 590ms | 16.7ms / 2 | 347.6ms / 1 | 87.9ms / 154 | 54.6 / 8 | 12.9 / 103 | 5 |
| 2 | 635ms | 15.1ms / 3 | 372.3ms / 2 | 160.4ms / 302 | 56.3 / 7 | 14.5 / 105 | 4 |

TURNS=0 的同一 trace：UpdateLayoutTree 283.6–310.6ms（分 10–11 次，每次约 30ms），Layout 11.5–11.9ms，Paint 37.8–45.3ms。**样式重算从 ~30ms/次增长到 ~175–350ms/次，帧预算被它吃穿；Paint 也涨，但量级小；Layout 始终可忽略。**

### 1.3 宽度证据：没有文本重排

- `.flow` 的 `getBoundingClientRect().width`：折叠前 760px，折叠中 760px（rail 已 off）。
- 滚动容器 `clientWidth` 从 1160 增到 1424，而 `.flow` 恒 760px。
- 所以「会话列变宽 → 文本折行 → 重排」在本台架条件下不成立。

---

## 2. 机制对照：样式重算，不是布局

全部 TURNS=150、CPU=4：

| 变体 | p50 | worst | 帧数/6 | RecalcStyle 总 | 说明 |
|---|---|---|---|---|---|
| baseline | 83.5 / 132.6 | 434.8 / 561.8 | 15 | 2483.7 / 2794.7 | 两次复跑，方差大 |
| `transition:none !important` | 18.1 | 492.4 | 15 | 2217.3 | 补间消失，但仍有一次 ~490ms 整树重算 |
| `transition:none` + 固定 grid 列 | 448.6 | 662.0 | 12 | 3142.7 | 固定列毫无帮助（噪声偏慢） |
| `.app{--rail-w:0px!important}` | 17.9 | 463.7 | 18 | 2149.2 | 每帧重算消失，首次 ~460ms 仍在 |
| unpinned（向上滚，停止 follow） | 90.1 | 456.9 | 13 | 2358.8 | 与 pinned 无差异 |
| `data-effects="reduced"` | 371.8* | 511.2 | 10 | 2555.7 | 帧少导致 p50 失真；无改善 |
| 宽 1100（fold=rail） | 357.7* | 470.4 | 11 | 2424.4 | 1100 不触发 scene（阈值 640） |
| 宽 600（fold=rail side scene） | 64.6 | 452.8 | 20 | 2594.5 | grid 折叠前后都是 `0px 0px 600px 0px`，成本不变 |

纯 DOM 机制隔离（TURNS=150, CPU=4, 4 次 toggle）：

| 操作 | p50 | worst | RecalcStyle 总 | 结论 |
|---|---|---|---|---|
| Ctrl+B | 76.9 | 471.7 | 1667.1 | 对照 |
| 直接翻 `app.dataset.rail`（绕过 React） | 82.0 | 455.9 | 1888.4 | 与 Ctrl+B 相同 → 不是 React 渲染 |
| 只 `style.setProperty("--rail-w", …)` | 111.7 | 162.1 | 859.5 | 没有 450ms 大帧，但每次切换 6 次 ~36ms 重算 |
| 无关属性 `app.dataset.probe` | 16.5 | 27.4 | 0.6 | 任意属性变更本身免费 |
| 无关 class 切换 | 16.6 | 26.4 | 0.8 | 同上 |

**两条独立机制**：

1. **`data-rail` 翻转的一次性全子树失效**：约 350–500ms（TURNS=150/CPU=4），随 DOM 规模增长；`transition:none` 和钉死 `--rail-w` 都消不掉它。无关属性/class 完全免费，证明是选择器 `.app[data-rail] …` 的全子树重匹配。
2. **`--rail-w` 的逐帧继承重算**：`@property` 注册为 `inherits: true`，CSS transition 每帧改变它，整棵子树每帧重算样式；只改这一个属性就能复现每次切换 6 次、每次 ~36ms 的重算。`.flow` 的 `--rail-w: initial` 只切断它子孙的计算值，切不断重算遍历。

---

## 3. 为什么长会话更卡

- DOM 节点数随轮次增长：1,171（0 轮）→ 2,644（20）→ 5,604（60）→ 12,264（150）→ 30,764（400）。
- 离屏块虽然卸载了内容，但每个块仍保留一个占位 `.chunk`；`IntersectionObserver` 观察所有占位块（`rootMargin: 200%`），布局/样式变化后要更新全部 target。
- 整树样式重算的成本 ∝ DOM 规模；新会话只有 1,171 个节点，长会话 3 万个，差 26 倍。
- 「只有 4k 上下文」的真实会话已经可能包含大量代码块、工具卡、Markdown 节点，等价于台架的中高轮次；拐点在 150 轮附近，4k 真实内容很容易越过。

---

## 4. 右工作台

同一类祖先属性失效，但细节不同：

- `data-browser` 挂在 `.app` 上，CSS 里是 `.app[data-browser="off"] .pane:has(> .pbody[data-dock]) …` 这类后代 + `:has()` 选择器；每次开关触发一次全文档样式重算，规模随 DOM 增长。
- `--dock-w` 已经在之前的修复里改成 `inherits: false` 并落在 `.pane`（`tokens.css:45`、`dock.css:9`），所以**没有**左栏那种每帧整树继承重算；剩下的每帧成本是 `.pane` 的 grid 轨道布局 + 重绘（Layout 在左栏测量里很便宜，但 `.pane` 子树更重）。
- View Transition：`showView` 走 `swapping()`，起止各截一次整块 pane 快照，`flushSync` 强制同步提交，一次性但很重。
- 原生浏览器视图（Electron 独有）：`BrowserPanel.tsx:246-279` 的 ResizeObserver + body MutationObserver + transitionend/animationend + 400ms 轮询，48ms 去抖后 `showBrowserView(target, box)`。
- `visibleBox` 逐祖先 `getComputedStyle`，`occluded` 最多 81 次 `elementsFromPoint` + `paints()`（每次再算祖先/伪元素样式），再跨进程 `setBounds`。工作台里开着浏览器页时，动画期间每 48ms 一次这套探测 + IPC。
- 工作台每次 `shown` 变真都会重新读文件树和当前文件（`WorkbenchPanel.tsx:229-270`、`useWorkbenchFiles.ts:86-93`），并重建 tab 条宿主（`useWorkbenchDock`）。
- 所以右栏的掉帧是：**一次性全文档重算（`data-browser`）+ VT 快照 + 原生视图/文件树**，与左栏的「逐帧继承重算」不是同一条主因；修复要分开做。

---

## 5. WebUI / 安卓不复现：先前的解释被否定

我此前根据代码提出「窄屏 scene 把 rail/dock 列钉死为 0，所以不重排」，**测量否定了它**：

- 600px scene 下 `.cols` 折叠前后都是 `0px 0px 600px 0px`，grid 列确实固定，但 p50 64.6ms、一次 ~452ms 大帧、RecalcStyle 2594.5ms，与宽布局同量级。
- 成本本来就不在 grid 列布局上，固定列救不了。

剩余候选（需要你侧核实）：

1. **安卓/WebUI 很可能没有走这条 `data-rail` / `--rail-w` 过渡路径**：移动端可能是另一套抽屉状态/属性，或 `prefers-reduced-motion` / touch 规则直接禁用了补间；这时既没有 `data-rail` 翻转，也没有逐帧继承重算。
2. **DOM 规模不同**：安卓通常只开一个会话，没有桌面的会话树/工作台；同样 4k 上下文，节点数可能远小于桌面。
3. **构建/偏好不同**：`rx-effects=full`、`rx-weight=heavy`、`rx-dock-w=516` 这些 prefs 只在桌面版从磁盘恢复；WebUI 按端口 origin 隔离，安卓另一套存储。不过 `effects=reduced` 在本测量中无改善，所以特效不是主因，但 DOM/路径差异仍在。
4. **桌面 WebUI 在 1650px 下应当能复现**：台架就是 Chromium，且已复现；如果 Web UI 在同宽度、同 DOM 规模下仍流畅，那才是 Electron 渲染路径的差异，需要一次 Performance trace 对比 Recalculate Style。

建议的 30 秒核实：在 WebUI/安卓和桌面各执行

```js
document.documentElement.dataset.fold
document.querySelectorAll('*').length
getComputedStyle(document.querySelector('.app')).getPropertyValue('--rail-w')
```

开合时看 `--rail-w` 是否连续变化、`data-rail` 是否翻转、节点数是否同量级。

---

## 6. 历史：这是已知的 B1/B2，不是新问题

`docs/SESSION_HANDOFF.md` §8（2026-11-23）原文：

> 长对话打开/长跑后 GUI 卡顿；侧栏折叠必卡且重载不缓解。
> 折叠卡顿 = `.app` 上注册型继承自定义属性的 CSS 补间逐帧重算 `.flow` 外整棵树 + 折叠首帧挂载/卸载整棵会话树 + 折叠期 ResizeObserver 风暴。
> 剩余折叠成本 = B1（属性补间逐帧重算）+ B2（首帧挂树），属设计取舍，**待用户拍板方案**后做第二批。

历史修复（仍在树上）：

- `9fe36abc5`：`.pane[data-off] { content-visibility: hidden }`，3 pane/4x 中位帧 94ms → 18ms。
- `23be188e9`：`.flow { --nav-w/--rail-w/--side-w: initial }`，300 轮折叠 430ms 样式重算 vs 3ms 布局；中位帧 128ms → 46ms（4x）。
- `cb2552e5a`：`--dock-w` 改为 `inherits:false` 并落在 `.pane`，降低工作台开关的全窗口重算。

现有门禁的盲区（`perf/rail-toggle-panes.mjs`）：

- `TURNS=60` 写死，只比 1 vs 3 个 pane 的 p50 ×2.5，不扫会话长度；
- 视口 1440 + `.flow` 760px 钳制，看不到宽度/文本变化；
- 只判 p50，p95/worst 只打印；
- 测量窗口 450ms 而过渡 260ms，静止帧稀释中位数；
- `inherited` 断言只证明自定义属性未继承，证明不了「没有整树重算」；
- CI 跑在 ubuntu Chromium，而症状在 Windows/WebView2 桌面。

---

## 7. 处置选项（先不动代码，等你拍板）

### A. 收窄失效范围（B1，推荐先做，改动最小）

- 把 `--rail-w` / `--side-w` 改成 `inherits: false`，只落在真正消费它的元素上（`.cols` 的 grid、`.rail`、`.chrome`），照抄 `--dock-w` 落在 `.pane` 的既有先例。
- 把 `data-rail` 从 `.app` 移到最小所有者（或改用只影响 rail/cols 的 class），重写 `.app[data-rail] …` 后代选择器，避免翻转时整棵 transcript 重匹配。
- 把 `inert` 与补间的时机分开（收起完成后再设/撤 `inert`），减少一次性失效的节点集。
- 预期：去掉每次切换 6 次 × ~36ms 的逐帧重算，并把首次 350–500ms 的全树重算缩到 rail/cols 范围。

### B. 改运动架构（结构性修复）

- 不要再补间 grid 轨道。`.rail` 已经是 `position:fixed`，可以直接做一个 transform/opacity 的 overlay 抽屉，宽度一次性提交；transcript 不移动、不重算。
- 代价：视觉行为变化——内容不再随栏宽实时重排（和手机抽屉一致）。如果产品接受，这是最稳的。
- 右工作台同理：可以考虑只在动画结束后提交 grid 列宽，或让原生视图在动画期间冻结（已经有一套 `freezeBrowserView`）。

### C. 右工作台专项

- 收窄 `data-browser` / `:has()` 的后代失效范围；决定 VT 是否值得为一次开关截两张整 pane 快照；原生 `WebContentsView` 在动画期间减少 `setBounds`/遮挡探测（48ms → 动画结束一次），并确认“开着浏览器 tab”与“只开文件 tab”的差异。
- 文件树/当前文件在每次 `shown` 变真时重读，可以改为缓存 + 失效标记。

### D. 门禁（必须一起做）

- `rail-toggle-panes.mjs` 增加 `TURNS` 轴（0/20/60/150/400）与 `p95/worst` 断言，断言 `RecalcStyleDuration` 而不是只看帧间隔。
- 增加 `?measure=full` 或窄窗口场景，避免 `.flow` 760px 钳制掩盖真实重排。
- 至少在一台 Windows/Electron 或 Windows Chromium 上跑；Linux CI 只能做趋势门禁。

### E. 临时缓解（不是修复）

- 大 DOM/低端设备上跳过 tween，直接切换；能保住可用性，但不解决根因。

---

## 8. 待确认

1. 桌面 Settings → Appearance → Graphics 的「图形合成状态」值（`enabled` / `disabled_software` / `unavailable_off`）。启动参数未禁用 GPU，GPU 进程存在，但实际合成路径未证实；不过本问题在 Chromium 台架已复现，前端样式重算已足够解释，GPU 只可能是放大器。
2. 右工作台当时开着的是文件、变更还是浏览器页；浏览器页会引入 Electron 独有的 `WebContentsView` 成本。
3. WebUI/安卓的 `dataset.fold`、`data-rail` 是否翻转、DOM 节点数；这决定“平台差异”是路径不同还是规模不同。
4. 真实会话的 DOM 规模（`document.querySelectorAll('*').length`）与台架 30,764 节点的对应关系。

---

## 附：关键文件

| 关注点 | 文件 |
| --- | --- |
| `--rail-w/--side-w/--dock-w` 注册 | `desktop/frontend-next/src/styles/tokens.css:42-45` |
| `.app` 的补间与 `data-rail` | `desktop/frontend-next/src/styles/app.css:482-487` |
| `.cols` grid 轨道 | `desktop/frontend-next/src/styles/app.css:493`、`studio.css:384` |
| `.rail` 的第二条 width 补间 | `desktop/frontend-next/src/styles/studio.css:389-401` |
| `.flow` 的变量隔离 | `desktop/frontend-next/src/styles/app.css:743-748` |
| `.pane` 容器查询 | `desktop/frontend-next/src/styles/app.css:2032` |
| 隐藏 pane 跳过布局 | `desktop/frontend-next/src/styles/app.css:4015` |
| transcript 的 RO→follow | `desktop/frontend-next/src/ui/Transcript.tsx:118-129,367-375` |
| ScrollJump 的 RO | `desktop/frontend-next/src/ui/ScrollJump.tsx:19-44` |
| 右 dock grid 与补间 | `desktop/frontend-next/src/styles/dock.css:9-11`、`app.css:636-645` |
| 原生浏览器视图放置 | `desktop/frontend-next/src/ui/BrowserPanel.tsx:246-291`、`ui/occlusion.ts` |
| 历史诊断 B1/B2 | `docs/SESSION_HANDOFF.md:435-462,699` |
| 现有折叠门禁 | `desktop/frontend-next/perf/rail-toggle-panes.mjs` |
