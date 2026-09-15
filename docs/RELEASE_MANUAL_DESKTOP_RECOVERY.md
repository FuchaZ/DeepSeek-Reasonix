# Desktop 临时跳过 SignPath 的发布交接 / Manual Desktop release handoff

本文是桌面免签手动下载例外的操作手册，供后续发布 agent 使用。第 1–6 节记录 v1.38.8
的首次恢复流程，是已完成发布的操作记录，不是重新发布 v1.38.8 的指令。第 7 节说明例外
现在的授权方式：`scripts/manual-desktop-exception.sh` 是唯一属主，新增一行才等于授权
一个新版本，本文本身不构成授权。

English summary: the exception removes Windows SignPath/Authenticode only. minisign,
SHA-256, artifact identity, native builds, and startup verification always stay on, and no
Desktop update entry point may advance while it is active. CLI/npm ship normally and the
website manual-download source is updated independently. v1.38.8 was the first incident;
v1.38.9 reused the same distribution shape after the allowlist moved into one owning
script. Artifact-reuse inputs remain pinned to the v1.38.8 producer run and are not part
of the general exception.

## 1. 接手后先读这些结论

- **v1.38.8 已发布完成，不要重打标签、重建或覆盖成功产物。**
- 用户怀疑 SignPath 额度耗尽；实际工作流证据是 SignPath 请求被拒绝。不要把未经独立确认的额度判断写成确定根因。
- 用户明确接受：本次 Windows 不做 SignPath/Authenticode 签名；**所有 Desktop 平台仅手动下载**；CLI/npm 正常发布；Desktop 自动更新保留 v1.38.7。
- “不走签名”不等于去掉全部签名。**minisign、SHA256、产物身份验证、原生构建和实际启动验证均保留。** 不修改 macOS 或其他平台的签名策略来扩大例外。
- 原本考虑只让 Windows 不自动更新，但现有客户端校验完整共享 manifest；不能删除 Windows 条目来推进其他平台。因此本次所有 Desktop 平台一起保留旧更新入口。
- 产品候选已经冻结。后续 main-v2 合入 PR 不应让本次发布重新开始；控制工作流可修复，产品标签和源码身份不变。

## 2. 冻结身份与最终发布状态

产品源码 SHA：`7278072720a2dc7a31cce0eec18c1eacc149c0e0`。

以下三个不可变标签都指向该 SHA：`v1.38.8`、`npm-v1.38.8`、`desktop-v1.38.8`。

| 发布入口 | 本次最终状态 |
| --- | --- |
| [CLI Release](https://github.com/esengine/DeepSeek-Reasonix/releases/tag/v1.38.8) | v1.38.8 |
| npm `reasonix` 和六个 CLI 平台包 | 1.38.8；官方 latest/canary/next 均核验通过 |
| Homebrew | 1.38.8 |
| [Desktop Release](https://github.com/esengine/DeepSeek-Reasonix/releases/tag/desktop-v1.38.8) | v1.38.8；手动下载；附 Windows 未签名说明 |
| [Desktop 不可变 manifest](https://dl.reasonix.io/desktop-v1.38.8/latest.json) | v1.38.8，完整产物及 minisign |
| [Desktop R2 更新入口](https://dl.reasonix.io/latest/latest.json) | **v1.38.7** |
| [Desktop gateway 更新入口](https://crash.reasonix.io/v1/desktop/releases/stable/latest.json) | **v1.38.7** |
| GitHub `/releases/latest` | Desktop latest 保留 desktop-v1.38.7 |
| [官网手动下载](https://reasonix.io/?download=desktop#start) | **v1.38.8**，与自动更新独立 |

以上是本次完成时的历史状态，后续正常发布可能改变可变入口。执行恢复前必须重新读取线上状态，不要强行将未来版本降回这些历史值。

## 3. 实现入口与限制

| 文件 | 作用 |
| --- | --- |
| [release-stable.yml](../.github/workflows/release-stable.yml) | 唯一稳定版编排入口；控制恢复、发布范围及人工审批 |
| [release-desktop.yml](../.github/workflows/release-desktop.yml) | SignPath 例外、原生构建、minisign、产物复用和不可变 R2 发布 |
| [publish-desktop-github-release.sh](../scripts/publish-desktop-github-release.sh) | 手动模式使用 `--latest=false` |
| [verify-stable-release-artifacts.sh](../scripts/verify-stable-release-artifacts.sh) | 公共产物及手动模式状态核验 |
| [verify-manual-desktop-producer.mjs](../scripts/verify-manual-desktop-producer.mjs) | 核验固定产物生产 run 的身份和六个成功构建 |
| [release-channels.js](../site/src/scripts/release-channels.js) | 官网 `fetchDesktopDownloadModel` 独立选择手动下载版本 |
| [manual-desktop-exception.sh](../scripts/manual-desktop-exception.sh) | **例外允许列表的唯一属主**；编排器、桌面工作流和发布脚本都向它校验 |

关键输入：

- `allow_recovery=true`：允许恢复 main-v2 历史上的既有稳定标签，不改变标签。
- `desktop_manual_only=true`：默认 false；允许的标签由属主脚本决定；Desktop 还要求由稳定版编排器调用。属主脚本里带固定 SHA 的行是历史恢复，必须配 `allow_recovery=true`；不带 SHA 的行是授权时候选尚未存在的新版本，必须配 `allow_recovery=false`，从而保留完整候选与 push CI 校验。**免签例外不能换取跳过候选校验。**
- `reuse_manual_artifacts=true`：默认 false；仅与上述手动模式搭配使用；复用固定历史 run，不能填入任意产物来源。
- `publish_cli`、`publish_npm`、`publish_desktop`：按实际缺失的发布入口选择。已成功发布的入口不因后置验证失败而重发。

手动模式让 `HAS_SIGNPATH=false`，跳过 Windows Authenticode 必需检查，但保留手动包 manifest、重新封装和 minisign。R2 仍上传、读回并验证版本目录，随后在修改更新入口前退出；不推进 GitHub latest，也不把新的 Desktop manifest 写入 CLI 兼容附件。

## 4. 本次恢复的执行顺序

1. 完成固定产品 SHA 的发布资格检查。完整候选 CI [34809059028](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34809059028) 第 3 次 attempt 成功；用标准 `scripts/release-stable.sh 1.38.8` 原子创建三个标签。
2. 普通发布 [34812968923](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34812968923) 遇到 SignPath 拒绝。先检查各 job，确认发布器尚未执行，再决定恢复范围。
3. 用户确认例外范围后，合并 [PR #10271](https://github.com/esengine/DeepSeek-Reasonix/pull/10271)。控制 SHA 为 `09cdab3866d77c6ff0d007ee61b6aca3128ebe54`；产品 SHA 不变。
4. 在受保护的 main-v2 控制平面 dispatch，打开 `allow_recovery` 和 `desktop_manual_only`，按编排器保留发布环境审批。不要直接绕过编排器运行单平台发布。
5. 手动构建 run [34816299501](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34816299501) 的六个原生构建成功；最后的 Intel Universal 启动验证因缺少 Playwright 失败，发布器未开始。
6. 合并 [PR #10273](https://github.com/esengine/DeepSeek-Reasonix/pull/10273)：安装锁定的验证依赖，并严格绑定原生产 run 复用产物。控制 SHA 为 `e4824a44fbda5c99b3fdae2da2cf30fea05a51b0`。
7. 恢复 run [34820045841](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34820045841) 同时打开两个例外开关。复用成功构建，补跑 Intel Universal 启动验证，CLI/npm/Desktop 发布器全部成功。
8. 此 run 的最终公共 CDN 探测从 GitHub runner 返回 403。本地独立执行手动模式校验通过，再通过仅 postflight run [34822351639](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34822351639) 完成发布记录和网站刷新；保留原失败记录。
9. 首次网站刷新只更新了发布记录，下载仍跟随旧 updater。通过 [PR #10274](https://github.com/esengine/DeepSeek-Reasonix/pull/10274) 单独修正网站，部署 [34823322854](https://github.com/esengine/DeepSeek-Reasonix/actions/runs/34823322854) 成功后验证线上链接。

### 历史命令示例：不要对已完成发布重复执行

以下展示当时输入组合。未来恢复前，先读取当前 workflow、标签及各发布入口，选择真正需要补发的范围。

```sh
# Historical recovery: all three surfaces were unpublished at this point.
gh workflow run release-stable.yml --repo esengine/DeepSeek-Reasonix --ref main-v2 \
  -f tag=v1.38.8 -f allow_recovery=true \
  -f desktop_manual_only=true -f reuse_manual_artifacts=true \
  -f publish_cli=true -f publish_npm=true -f publish_desktop=true

# Historical postflight-only recovery: all publishers had already succeeded.
# Manual-mode verification had independently passed before this dispatch.
gh workflow run release-stable.yml --repo esengine/DeepSeek-Reasonix --ref main-v2 \
  -f tag=v1.38.8 -f allow_recovery=true \
  -f publish_cli=false -f publish_npm=false -f publish_desktop=false
```

只执行 postflight 的绿色 run **不能单独证明**未签名例外的正确性；必须同时保留独立校验旧更新入口、完整产物和手动下载说明的证据。不要把 CDN 的 403 当作可无条件忽略的错误。

### 产物复用的固定身份

- Producer run：`34816299501`，attempt：`1`。
- Artifact prefix：`desktop-34816299501-1-preflight`。
- Producer control SHA：`09cdab3866d77c6ff0d007ee61b6aca3128ebe54`。
- Fingerprint：`v1:48c45e7bb52e5a9d0883b917c36e8cb0f4e7d34b6703ff44019d8ef5d52ebf21`。

校验包括仓库、事件、workflow、main-v2 控制身份、六个成功构建，以及收集阶段的原始产物身份和摘要。历史 artifacts 可能过期；过期后不要放宽校验或拼接其他 run 的文件。产品或产物身份发生变化时，需要重新制定和验证恢复方案。

## 5. 官网与自动更新必须分别处理

官网原本从 R2 `latest/latest.json` 或 Desktop stable gateway 读取版本，GitHub latest 作为后备。三者都保留 v1.38.7 时，重新部署网页也不会自动得到 v1.38.8 下载链接。

本次 `fetchDesktopDownloadModel` 同时读取正常 stable 来源和 v1.38.8 不可变 manifest；后者失败时用精确 GitHub tag 后备；验证产物完整性后按数值版本选择较新版本。未来更高 stable 版本会自然取代这次例外，不能简单把网站永远写死在 1.38.8。

验收时检查浏览器执行 JavaScript 后的真实 DOM，不能只检查 HTML、更新日志或 Pages job 绿色：

- `[data-release-version="desktop"]` 展示 v1.38.8。
- 8 个 `[data-desktop-asset]` 链接均指向 `desktop-v1.38.8/` 下已发布文件。
- macOS Universal/两种架构 DMG、Windows x64/ARM64 安装器和 portable ZIP、Linux deb/tar.gz 均覆盖。
- 再单独请求 updater manifest，确认仍为 v1.38.7。

## 6. 完成发布所需证据

1. 三个标签仍指向固定源码；区分 **产品 SHA** 与 **控制工作流 SHA**。
2. 所有原生构建和实际启动验证通过；失败的验证依赖要补齐，不能将 smoke 跳过作为修复。
3. Desktop GitHub Release 共 23 个文件：11 个 payload、11 个 minisig、1 个 manifest。公开 R2 payload 的大小/SHA256 与发布元数据一致，签名镜像也一致。
4. 固定版本 manifest 可用；R2 mutable manifest 与发布前逐字节一致；gateway 和 GitHub latest 均保留旧版本。本次旧 manifest SHA256 为 `e851d161ef8809bd3efbd5a78a5fcdd5434dc331fc10da0b35527368500f7aa4`。
5. 用实际公开包完成启动验证。本次 Darwin arm64 ZIP SHA256 为 `64449f46852f7dedb1a2cfadd145d4b0780c80cf7f96e008672d4839f7dc98fd`，核验了服务握手、renderer v1.38.8、正常退出和服务清理。
6. CLI 校验和、R2/gateway、Homebrew、npm 七个包的候选身份、签名和 provenance/attestation、官方 aliases 均核验。记录已知例外：npm `latest-staging` 清理被策略以 E403 拒绝，但官方 aliases 已验证正确；不要把失败清理说成已完成。
7. `release-event.json`、更新日志索引及精确版本页面可访问；Windows 未做 Authenticode 签名的说明已公开。
8. 官网部署成功，浏览器真实下载链接已核验。**“Release 已发布”和“官网下载已更新”是两个独立验收项。**

读操作示例，接手时按实际目标版本调整：

```sh
gh release view desktop-v1.38.8 --repo esengine/DeepSeek-Reasonix --json url,assets,body
gh api repos/esengine/DeepSeek-Reasonix/releases/latest --jq .tag_name
curl -fsSL https://dl.reasonix.io/latest/latest.json | jq .version
curl -fsSL https://crash.reasonix.io/v1/desktop/releases/stable/latest.json | jq .version
curl -fsSL https://dl.reasonix.io/desktop-v1.38.8/latest.json | jq .version
```

## 7. 后续版本与恢复正常签名

- 正常发布使用默认 `desktop_manual_only=false`、`reuse_manual_artifacts=false`，恢复原有 SignPath preflight 和 Authenticode 必需检查，成功后按标准流程推进更新入口。
- 本次临时处理没有解决 SignPath 服务拒绝本身。下次发布前检查服务实际状态和额度，验证两种 Windows 架构签名链路；不要仅凭账户页面看起来正常就认为构建会成功。
- 若后续版本仍需无 Authenticode 发布，先取得该版本的明确授权，再在
  `scripts/manual-desktop-exception.sh` 增加一行，并同步更新网站手动版本来源。属主脚本
  的行就是授权边界，改动要走评审；`scripts/manual-desktop-exception.test.sh` 覆盖未授权
  标签、候选 SHA 不符、以及两类行的 `allow_recovery` 取值。**`desktop_manual_only` 不是
  通用免签名模式，加一行才是一次新授权。**
- 不要为了更新官网而将未按正常签名流程验证的版本写入 updater latest；也不要覆盖既有 v1.38.8 文件为重新签名的不同字节。恢复签名宜发布新的版本。
- 未来稳定版已超过 v1.38.8 且网站验证完成后，可以在独立维护变更中移除这次网站固定版本来源和工作流历史复用逻辑，保留本文作为事件记录。

## 8. 给后续 agent 的任务模板

> 先阅读本文、当前 reasonix-develop 发布技能及实际工作流。本文记录已完成的发布，不授权重发或移动任何标签。接手时先读取线上状态，确认目标版本、冻结产品 SHA、控制 SHA 和待恢复的发布入口。仅恢复缺失环节，保留已成功产物。若任务明确要求新的 SignPath 例外，先确认该版本已在 `scripts/manual-desktop-exception.sh` 获得授权行；保持 minisign、产物身份校验和原生启动验证；分别设计官网手动下载与客户端自动更新策略；完成公开产物、官网真实链接及更新入口核验后再报告完成。
