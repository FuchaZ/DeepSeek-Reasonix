# Reasonix 复现「先测量、再回答、给证据」行为：只读评估

> 只读分析，未改动任何源码。分析对象：截图里 Claude 桌面版回答「每张设备卡片是否等高」时表现出的那一类行为。
> 日期：2026-11-27

---

## 0. 结论

**工具不是瓶颈，提示层才是。**

| 层 | Claude 桌面版（截图） | Reasonix 现状 | 是否需要改 |
| --- | --- | --- | --- |
| 系统提示 | 明确要求用工具验证、先证据后结论 | 基础提示只有 3 行；六条 core policy 中只有 `WorkPracticePolicy` 提到「验证」，且限定在「改动」上 | **需要补一条处置原则，但不必改基础提示** |
| 工具 | shell、文件读写、读图、把图发回对话 | `bash`、文件读写、`view_image`、浏览器截图、`present_files`、Markdown 内嵌图片等均已具备 | **不需要新增工具** |
| 技能 | `check` 技能强化证据纪律 | 技能系统完整，且兼容 `.claude/skills` 与 `~/.claude/skills`；但没有随包内置的 UI 证据技能 | **建议加一个项目技能** |
| 上下文 | 本地项目、可读代码、自带渲染器 | 同一套工作区；本机 Python 3.13 + Pillow 11.3、Node 24 + Playwright 可用 | **不需要改** |

一句话：**Reasonix 已经「能看见、能动手、能展示」，缺的是「遇到可以核验的问题就先核验」的默认处置，以及把「渲染 → 测量 → 标注 → 展示」写成可复用流程。**

最小落地路径是（都不动缓存前缀）：

1. 在项目或用户级 `REASONIX.md` 里加 2–3 句「可核验就先核验」的原则；
2. 新建一个 `ui-evidence` 技能，把测量与展示步骤写清楚；
3. 现有 `~/.claude/skills/check` 可以直接被 Reasonix 读取，无需移植。

---

## 1. 先把 Claude 那次行为拆成四层

截图里的解释本身是对的，它不是某一个隐藏开关，而是四层叠加：

1. **Harness 系统提示**：要求用工具验证，而不是只凭代码阅读下结论；并提供图片、文件链接、任务清单等交互约定。
2. **工具**：能执行命令、读写文件、读图片、把生成的图片发回对话。
3. **Skill**：`check` 技能强化了「没有命令输出就不要说验证过」；但「测量卡片高度」那一步是临场发挥，不是技能里的固定指令。
4. **上下文**：项目在本机、代码可读、自带离屏渲染器，所以能精确复现用户看到的界面。

这四层里，**第 1 层决定「想不想验证」，第 2 层决定「能不能验证」，第 3 层决定「会不会按流程验证」，第 4 层决定「验证得了吗」**。下面逐层对照 Reasonix。

---

## 2. Reasonix 逐层现状

### 2.1 系统提示层：对「改动」有验证要求，对「问题」没有

Reasonix 的提示是分层拼装的：

- **基础提示**只有 3 行（`internal/contract/config/config.go:1306-1309`）：

  > You are Reasonix, a coding agent.
  > Use the available tools when they help you complete the user's request.
  > Keep changes focused and responses concise.

- 之后追加六条 core policy（`internal/assembly/boot/prompt_policy.go:8-15`、`internal/contract/config/policies.go`）：
  - `UserDecisionPolicy`：重大选择用 `ask`；
  - `WorkPracticePolicy`：按指定方案实现、临时文件放 `$TMPDIR`、**按改动规模验证**：「reproduce the problem and run the most relevant focused tests」；
  - `ToolBatchPolicy`：无依赖的调用同一轮发出；
  - `LanguagePolicy`：跟随用户语言；
  - `InstructionDeliveryPolicy`：说明 `REASONIX.md / AGENTS.md / CLAUDE.md` 以 `<project-instructions>` 块随轮次到达；
  - `ExternalContentPolicy`：外部内容按数据处理。

- 更直接的「不要无证据宣称成功」那段提示**已被退役**，只作为负向测试夹具保留（`internal/assembly/boot/token_profile.go:10-17`）：

  > Do not claim success without evidence. State any unverified result or assumption explicitly.

- 每轮模型实际看到的验证信号是 `<execution-policy preset="balanced" version="3" verify="targeted">`（`internal/runtime/taskpolicy/policy.go:61-79`）。它只有诊断意义，**没有向模型解释 `verify=targeted/full` 是什么意思**；真正执行验证约束的是宿主侧的 evidence ledger（`internal/safety/evidence/`）与完成回执（`internal/runtime/completion/report.go`）。

- 技能索引走 turn tail，头部很强（`internal/ext/skill/index.go:19-20`）：

  > Before non-trivial work, scan it: if an untagged (inline) skill is even plausibly relevant to the task, invoke it before continuing instead of pre-judging…

**结论**：Reasonix 的验证纪律主要落在「宿主能不能证明改动」上，而不是「模型遇到一个是非题时要不要先核验」。`WorkPracticePolicy` 的验证句子绑定在「change」上，用户问「这个界面是不是不等高」时不会触发。这是与 Claude 那次行为最直接的差距。

### 2.2 工具层：能力已经齐了，不需要新增内置工具

把截图里用到的能力逐项对照（工具实现都在 `internal/tools/builtin/`）：

| Claude 那次用到的能力 | Reasonix 对应 | 状态 |
| --- | --- | --- |
| 执行 shell / Python | `bash`（含 `bash_output` / `kill_shell` / `wait` 后台作业） | 有，核心工具，默认可见 |
| 读布局代码 | `read_file`（带行号）、`grep`、`glob`、`ls`、`code_index` | 有；搜索类工具经 `use_capability` 索引 |
| 跑项目自己的渲染器 | 任意 `bash` 命令；本机 Node 24 + Playwright 可用 | 有 |
| 像素测量 | 无专用工具；`bash` + Python/Pillow（本机 11.3）或 Node 图像库 | 有路径，无需新工具 |
| 读图片本身 | `view_image`（PNG/JPEG/GIF/WebP），仅当模型声明读图时注册（`internal/tools/builtin/viewimage.go:56-58`、`internal/assembly/boot/view_image_tool.go:14-24`） | 有；DS-flash 在官方目录里声明了 vision（`internal/contract/config/deepseek_catalog.go:38-39`） |
| 把图片发给用户看 | 三条通道：① 工具结果的 `Tool.Images` 在 Studio 渲染为缩略图（`desktop/frontend-next/src/ui/cards/ToolCard.tsx:383,418-431`）；② 回答里写 Markdown 工作区图片路径会内联渲染（`Markdown.tsx:251-262`）；③ `present_files` 交付卡片可预览图片（`docs/FILE_PREVIEW.md:59-67,83-92`） | 有 |
| 浏览器打开页面并截图 | `browser_open` / `browser_read what=screenshot`（`internal/tools/builtin/browser.go:152-160,231-236`），截图同时给模型和用户 | 有；经 `use_capability` 索引 |
| 操作真实应用窗口 | `computer_read` / `computer_act`（仅 Studio + CUA Driver） | 有；但 **Reasonix Studio 自身窗口被明确禁止**（`internal/platform/computer/session.go:21-24,39-40,69-70`） |
| 画图表 | `render_chart`（内联图表） | 有 |
| 交付文件卡片 | `present_files`（1–4 个文件，默认开启） | 有；经 `use_capability` 索引 |

工具面还有两个值得注意的细节：

- **`view_image` 是顶层可见的**（注册后进入 provider schema，`internal/assembly/boot/agent_preset.go:156-162`），不是藏在代理后面；模型可以直接调用。
- **`browser_*`、`grep/glob/ls`、`present_files` 藏在 `use_capability` 后面**，但 `use_capability` 的描述里有一行「Deferred tools, called by id: …」，把这些工具的名字和首句描述列出来（`internal/runtime/usecap/deferred_index.go:12-48`）。这是 schema 体积与可发现性的折中：多一次代理调用，不是能力缺失，但会带来一点「多一步」的摩擦。

**结论**：这次行为所需的工具能力，Reasonix 已经覆盖，且图像回显通道比截图中 Claude 的描述更完整（工具缩略图、Markdown 内嵌、交付卡片三种）。**不需要新增内置工具。** 真要补，也只是补一句工具描述，而不是补能力。

### 2.3 技能层：系统完整，但缺一个 UI 证据技能

- 技能发现根（`internal/ext/skill/skill.go:427-461`）从高到低：
  1. 项目目录下的 `.reasonix / .agents / .agent / .claude` 里的 `skills/`；
  2. 配置的自定义路径；
  3. Reasonix home 的 `skills/`；
  4. 用户 home 下的同名约定目录（含 **`~/.claude/skills`**）。

  也就是说，**Claude Code 的项目技能和用户技能可以直接被 Reasonix 读取**，不需要转换格式；`.claude` 下的扁平 `.md` 需要 frontmatter，文件夹 + `SKILL.md` 则直接可用。

- 本机 `~/.claude/skills/check/SKILL.md` 存在，Reasonix 正常情况下会把它列进技能索引。截图中反复出现的「没有命令输出就不要说验证过」正属于这个技能的职责。

- 技能索引随每轮 turn tail 到达（`internal/session/control/turn_projection.go:57-88`），且措辞明确要求「非平凡任务先扫描技能，哪怕只是可能相关也先加载」。这比 Claude 那边的技能机制只强不弱。

- 但随包内置的技能只有 `reasonix-guide`（`internal/ext/skill/builtincontent/reasonix-guide/SKILL.md`），**没有 UI 检查 / 视觉测量类技能**。

**结论**：复用 `check` 技能即可覆盖代码审查场景；「UI 测量与展示」需要自己写一个技能，这是最划算的改动。

### 2.4 上下文层：同一套工作区，能复现

- 项目指令（`REASONIX.md / AGENTS.md / CLAUDE.md`）以 `<project-instructions>` 块随轮次到达，具有「standing rules」的权威，且不进入缓存前缀（`internal/session/control/turn_projection.go:71`、`internal/contract/config/policies.go:18`）。
- 工作区路径、VCS、日期、技能索引、记忆召回都以 turn block 注入（`turn_projection.go:57-88`），每轮都能看到。
- 本机确实具备截图里那套测量条件：Python 3.13 + Pillow 11.3、Node 24 + Playwright，本项目自己还有一整套 `desktop/frontend-next/perf/*.mjs` 浏览器测量脚本可参考。
- 一个明确限制：**Studio 不能用 `computer_read` 截自己的窗口**（自身的可执行名在禁止列表里）。所以「检查 Reasonix 自己的实时界面」只能走项目自己的渲染器/测试页，或者由用户提供截图。

**结论**：上下文不是问题。

---

## 3. 真正的差距只有四条

1. **处置原则缺失（提示层）**
   没有一条通用的「可核验就先核验」原则。现有 `WorkPracticePolicy` 只覆盖「改动后的验证」，不覆盖「用户问一个是非题时先取证」。这是 Claude 那次行为与 Reasonix 默认行为之间最大的差别。

2. **流程知识缺失（技能层）**
   即使模型想核验，也没有一份写好的「渲染 → 测量 → 标注 → 展示」步骤，尤其在项目没有现成 renderer、或 Pillow 不可用时。技能可以把这些步骤和回退路径固化下来。

3. **宿主闭环不完整（可选，代码层）**
   `internal/safety/evidence/render.go` 已经实现了 `unseen_render` 义务：写完 `.html/.htm/.svg` 后，如果没有一次 `browser_read` 截图看过，就算欠一笔证据债。但当前生产代码里 **`UnseenRenders` / `OnlyRendersSeen` 没有任何调用者**（只在测试中出现），`completion` 的 gap 列表也不包含它。也就是说，「写完页面必须看一眼」这条宿主保证已经写好，但还没接线。另外它目前只覆盖 `.html/.htm/.svg`，不含 `.png`；`Viewed` 也只由 `browser_read` 填写（`internal/runtime/agent/tool_receipts.go:100-106`），`view_image` 不算一次「看」。

4. **两处小摩擦（工具描述层）**
   - `view_image` 的描述只说「the picture itself is shown to you」，没有说「Studio 里用户也会看到」。模型因此不知道这是一条展示通道，可能只把它当自检。
   - 搜索类工具与 `present_files` 藏在 `use_capability` 后，多一步代理调用；对强模型影响不大，对较弱模型可能降低主动使用的概率。

**非差距**（不要误判为需要改）：

- 工具能力：已齐。
- 图像显示：Studio 完整（工具缩略图、Markdown 内嵌、交付卡片、点击放大）。
- 模型读图：DS-flash 已声明 vision；`view_image` 会注册。
- 上下文：本地项目可读、渲染器可跑。

---

## 4. 建议方案

### 方案 A：零代码，先做这两件（推荐）

#### A1. 加一条「可核验就先核验」的处置原则

放在**项目级 `REASONIX.md`**（只影响这个项目）或**用户级指令文件**（所有项目）里，不要放默认系统提示。原因：

- 项目/用户指令走 turn tail，不改变缓存前缀，不触发全量冷启动；
- 默认系统提示有 `TestDefaultSystemPromptStaysLean` 守着（≤240 字节、不重复 workflow 指导，`internal/contract/config/system_prompt_test.go:15-27`），它的设计意图就是「workflows 放 mode contracts 和工具描述」；
- 这条原则是判断，不是按关键词匹配用户措辞，符合仓库「judgements read structure, never wording」的约束。

建议文本（英文，保持与仓库提示一致）：

```markdown
## Evidence before assertion

When the user asks whether something is true of the code, the interface, or a
running system, and a tool can establish it, establish it before answering:
read the implementation, run the narrowest measurement, and show the value or
the picture you measured. If you could not check it, say what remains
unverified instead of asserting it.
```

如果只想让它在这个项目生效，追加到根目录 `REASONIX.md`；如果要全局生效，放到用户级指令文件（Reasonix home 下的 `REASONIX.md` / `AGENTS.md`，或 `REASONIX.local.md` 变体）。两处都会以 `<project-instructions>` 块送达。

#### A2. 写一个 `ui-evidence` 技能

建议路径：`.reasonix/skills/ui-evidence/SKILL.md`（或 `.claude/skills/ui-evidence/SKILL.md`，Reasonix 同样会扫描）。**不要用 `paths:` 门控**：门控只有在会话已经碰过匹配文件后才把技能列出来，而那时模型已经决定了做法；这个技能需要在问题出现的第一轮就可见。

示例（可按项目调整工具名与命令）：

```markdown
---
name: ui-evidence
description: "Answer UI/layout questions with measurement, not recollection: locate the layout code, render the real interface, measure pixels/geometry, annotate the result, and show the image. Use for 是否等高 / 对齐 / 间距 / 溢出 / 视觉回归 and any 'does it look right' question."
runAs: inline
---

# UI evidence

## When

The user asks whether something is true of a rendered interface, or reports a
visual defect. Do not answer from reading code alone when a render is possible.

## Steps

1. Find the real renderer. Prefer the project's own harness (perf scripts,
   Storybook, a dev-server route, a headless render test). jsdom unit tests are
   not pixel evidence.
2. Render the exact state the user described to a PNG at a known scale.
   Record the viewport, device scale factor, and CSS/DIP size.
3. Measure with a script under $TMPDIR (never inside the repository):
   Python + Pillow, or Node + the project's image library.
   Report measured values, not adjectives.
4. If the result is visual, annotate it (boxes, guides, numbers) and write the
   annotated file under $TMPDIR or the project's generated-artifacts dir.
5. Look at the image with `view_image`. In Studio the picture is shown to the
   person as well.
6. In the answer, embed the picture with a workspace-relative Markdown image
   path, or call `present_files` for a file card. State viewport, scale, and
   what you could not measure.

## Fallbacks

- No Pillow: Node `sharp`/`canvas`, or PowerShell `System.Drawing`.
- No renderer: say so, and ask for a screenshot or offer a code-only answer
  clearly labelled as unmeasured.
- HTML/SVG output: open it with `browser_open` and `browser_read what=screenshot`;
  the screenshot reaches both you and the person.

## Failure

Never present a guess as a measurement. If step 2 or 3 was impossible, the
answer must say which part is unverified.
```

这个技能同时解决「流程知识」和「工具选择」：它明确写了 `view_image`、Markdown 内嵌、`present_files`、`browser_read` 四种展示方式，以及没有 Pillow 时的回退。

#### A3. 复用现有 `check` 技能

`~/.claude/skills/check/SKILL.md` 已经存在，Reasonix 的正常发现路径会读取它。它适用于代码审查/发布门禁场景，和 A2 的 UI 证据技能互补，不需要移植。

### 方案 B：小代码改动（想让所有用户默认具备时）

#### B1. 给 `view_image` 的描述补一句展示语义

现在（`internal/tools/builtin/viewimage.go:56-58`）：

> Look at an image file (PNG, JPEG, GIF or WebP) in the workspace: the picture itself is shown to you, not a description. Needs a model that reads images.

建议在末尾补：**「In Studio the person sees the picture in the conversation too.」** 这与 `browser_read` 描述里已有的「the person is shown it too」一致，让模型知道「看图」同时是「给用户看」。改动只影响工具描述，不影响能力与权限。

#### B2. 把 `unseen_render` 接入宿主闭环

现状：`internal/safety/evidence/render.go` 已写好，但无生产调用者。建议二选一：

- **接到完成回执/门禁**：写完 `.html/.htm/.svg` 后没有一次 `browser_read` 看过，就在 `completion` 里记一个 gap（类似 `unreviewed_change`），或在 turn tail 提示「你写了一个页面但还没看」。
- **扩展判定**：如果希望「写图片」也受约束，需要同时决定 `view_image` 是否算一次「看」——目前 `Receipt.Viewed` 只由 `browser_read` 填写。合理做法是：HTML/SVG 仍要求 `browser_read`；生成的 PNG/JPEG 可以由 `view_image` 满足，并把它写进 `Viewed`。

注意：这是一条**行为保证**，不是提示词。它符合仓库「host-owned evidence, not model promises」的方向，但会改变完成回执的语义，需要设计确认与测试。

#### B3. 如果要把技能随包发布

把 A2 的技能放到 `internal/ext/skill/builtincontent/ui-evidence/SKILL.md` 并加入 embed。它会出现在所有用户的技能索引里（turn tail，不污染前缀）。适合「希望所有 Reasonix 用户默认具备」的产品决策；个人使用则 A2 的项目技能就够了。

#### B4. 文本模型下的图像路由（可选）

`view_image` 只在模型声明读图时注册。如果主模型是纯文本模型：

- 附件会走 `agent.vision_model` 路由，由 vision 子代理读图（`internal/session/control/turn_images.go:163-181`）；
- 但**工具产生的截图**（`browser_read`、`computer_read`）目前没有等价的自动路由；
- 子代理侧有 `childViewImage`，其模型读图时会拿到 `view_image`（`internal/assembly/boot/view_image_tool.go:26-44`）。

如果要在纯文本主模型下也支持「看图核验」，可以让模型把图片路径交给一个 vision 子代理（`read_only_task`），或后续把工具图片也纳入 vision 路由。DS-flash 已声明 vision，这一项当前不是问题。

### 方案 C：不建议做的事

- **不要**把长流程塞进默认系统提示或 core policy。它会改变所有会话的缓存前缀，违背 cache-first 与「默认提示保持精简」的既有测试/设计。
- **不要**用关键词判断「这是不是一个 UI 问题」。仓库明确禁止用措辞做判断；这类判断应由模型基于任务结构做，技能与指令是正确载体。
- **不要**新增一个「标注图片」专用工具。`bash` + 本机 Pillow/Node 已经足够，新增工具会扩大 schema 与前缀，收益不成比例。
- **不要**为这件事改 `verify=` 块的含义。它只是诊断信号，真正约束验证的是 ledger；把语义塞进这两行只会制造第二个真相。

---

## 5. 怎么验收

用一个和截图同构的问题做 A/B：

**问题**：「这些卡片是不是不等高？看起来下面空了一截。」

**期望的工具轨迹**：

1. `read_file` / `grep` 找到卡片布局常量；
2. `bash` 跑项目自己的渲染器，输出 PNG；
3. `bash` 跑测量脚本（Python/Pillow 或 Node），得到像素值；
4. 如有必要，`bash` 生成带红框/标注的图片；
5. `view_image` 看结果（Studio 中同时显示给用户）；
6. 回答里给出测量值、视口/缩放、以及未能核验的部分，并内嵌图片或调用 `present_files`。

**判定**：

- 有测量输出并展示图片 → 通过；
- 只读代码、没有渲染/测量就下结论 → 不通过（即使结论碰巧正确）；
- 渲染了但没有看（没有 `view_image` / `browser_read screenshot`）→ 不通过；
- 无法测量时明确说明「未核验」→ 允许。

**对照组**：关闭技能与指令后问同一个问题，观察差异。若差异不明显，说明模型本身已经具备该倾向，技能可以简化。

**如果改了代码**（B1/B2/B3）：按仓库要求跑 `gofmt -w .`、`go vet ./...`、`make lint`、相关包测试；涉及敏感路径的改动还需要 `review` + `security_review`。B2 属于 evidence/完成回执语义变更，应补 effect test（`internal/assembly/boot/effect_test.go` 模式），断言模型实际看到的请求或回执。

---

## 6. 需要你决定的三件事

1. **作用域**：只在当前项目生效（项目 `REASONIX.md` + 项目技能），还是所有项目生效（用户级指令 + 技能），还是随包发布（内置技能 + core policy）？
2. **是否接受为默认行为改稳定前缀**：如果选「随包发布 + core policy」，所有会话会冷启动一次；选项目/用户级指令则没有这个成本。
3. **是否要把「写完页面必须看一眼」变成宿主保证**：这需要接 `unseen_render` 并决定 `view_image` 是否算一次「看」，属于代码改动，不是提示词。

---

## 附：关键文件索引

| 关注点 | 文件 |
| --- | --- |
| 默认系统提示 | `internal/contract/config/config.go:1306-1309` |
| core policies | `internal/assembly/boot/prompt_policy.go:8-15`、`internal/contract/config/policies.go` |
| 退役的 delivery 提示 | `internal/assembly/boot/token_profile.go:10-17` |
| 每轮 execution-policy 块 | `internal/runtime/taskpolicy/policy.go:61-79` |
| 技能索引与调用策略 | `internal/ext/skill/index.go:19-20` |
| 技能发现根（含 `.claude`） | `internal/ext/skill/skill.go:427-461` |
| turn tail 注入点 | `internal/session/control/turn_projection.go:57-88` |
| 核心工具清单 | `internal/assembly/boot/agent_preset.go:48-74` |
| view_image | `internal/tools/builtin/viewimage.go:56-58`、`internal/assembly/boot/view_image_tool.go:14-44` |
| 浏览器截图 | `internal/tools/builtin/browser.go:152-160,231-236` |
| present_files | `internal/tools/builtin/present_files.go:32-35`、`docs/FILE_PREVIEW.md` |
| 工具图片在 Studio 的渲染 | `desktop/frontend-next/src/ui/cards/ToolCard.tsx:383,418-431`、`ActivityHead.tsx:62-71` |
| Markdown 内嵌工作区图片 | `desktop/frontend-next/src/ui/Markdown.tsx:251-262` |
| DS-flash 的 vision 声明 | `internal/contract/config/deepseek_catalog.go:38-39` |
| 延迟工具索引 | `internal/runtime/usecap/deferred_index.go:12-48` |
| evidence 义务与未见渲染 | `internal/safety/evidence/obligation.go`、`render.go:48-90,141-166` |
| 完成回执 gaps | `internal/runtime/completion/report.go:343-402` |
| Studio 自身窗口的 computer 禁用 | `internal/platform/computer/session.go:21-24,39-40,69-70` |
| 附件读图路由 | `internal/session/control/turn_images.go:163-181` |
