<p align="center">
  <img src="docs/logo-ghost-wave-effect.svg" alt="Reasonix" width="360"/>
</p>

> [!NOTE]
> **Reasonix Studio Tweaks** —— [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) `studio`（2.x）分支的个人 fork。上游停在 v2.61.0；本仓库从这里继续，对 Reasonix Studio 做小范围的改动：UI 布局、会话之间能够互相交流，以及后台辅助把对话往下推。

<p align="center">
  <a href="./README.md">English</a>
  &nbsp;·&nbsp;
  <strong>简体中文</strong>
  &nbsp;·&nbsp;
  <a href="./docs/GUIDE.zh-CN.md">指南</a>
  &nbsp;·&nbsp;
  <a href="./docs/ACP.md">ACP</a>
  &nbsp;·&nbsp;
  <a href="./docs/EXTENSIONS.md">扩展开发</a>
  &nbsp;·&nbsp;
  <a href="./docs/SPEC.md">规格</a>
</p>

<br/>

## 这个分支改了什么

本 fork 名为 **Reasonix Studio Tweaks**。引擎部分保持上游原样，改动都很小、范围明确，落在 Reasonix Studio 上：

- **UI 布局**：重排工作台、面板和输入区，把窗口更多空间留给对话和项目树，少留给人来看的壳子。
- **会话之间能交流**：跨项目的会话，以及同一项目里的多个会话，都能借助现有的 `peers` 机制互发消息、根据听到的内容行动，而不是每次都从零开始。
- **后台辅助**：有一个助手在对话背后工作，让台前那条对话继续往前走——它读上下文、把线索理顺，再把会话下一步需要的东西递回来。
- **小功能**：让应用更顺手的那些小改进，一项一项加。
- **小缺陷修复**：桌面外壳和网页界面里那些窄范围的问题逐个修掉，每个都带上对应的测试。

改动保持小而可审阅，不是重写。

## 版本

本 fork 从 **v2.6.1** 起步，在 `2.6.x` 线上一直往上走：每次发布加一位补丁号——2.6.1、2.6.2、2.6.3……不会跳到 2.7，新行为都以 `2.6.x` 补丁的形式发出。

版本发布在本仓库自己的[发布页](https://github.com/Oliver-Rui/Reasonix-Studio-Tweaks/releases)。上游最后一个版本仍是 v2.61.0。

## 安装

`Reasonix Studio` 是桌面端；CLI、Studio 和编辑器集成运行的是同一套本地 Reasonix 引擎。

从源码构建：

```sh
git clone https://github.com/Oliver-Rui/Reasonix-Studio-Tweaks.git
cd Reasonix-Studio-Tweaks
git switch studio
```

### CLI

CLI 构建需要 **Go 1.26+**。模块固定了 `toolchain`，保持 `GOTOOLCHAIN=auto`
即可让 Go 自动下载对应工具链，也可以手动安装。

```sh
make build      # -> bin/reasonix(.exe)
make cross      # -> dist/（darwin|linux|windows × amd64|arm64）
```

### Studio

Studio 的前端还需要 **Node 24+ 与 pnpm 10**（`npm install -g pnpm@10`）。

```sh
make studio
```

各平台的 webview 依赖和 Linux 构建标签见 [Studio 构建指南](desktop/README.md#prerequisites)。

## 快速开始

### Reasonix Studio

安装并启动 Studio，然后在应用内连接 provider 和模型即可使用，无需配置 CLI。

### CLI / TUI

```sh
reasonix setup                      # 配置 provider 和模型
reasonix                            # 启动交互式会话
reasonix run "把 main.go 里的 TODO 实现掉"
```

需要项目指令时，可在交互式会话中运行 `/init`。

CLI 进阶用法和详细配置见 **[CLI 命令参考](./docs/CLI.zh-CN.md)**、
**[指南](./docs/GUIDE.zh-CN.md)** 和
**[配置路径](./docs/CONFIG_PATHS.md)**。

## 文档

- **开始使用：** [指南](./docs/GUIDE.zh-CN.md) ·
  [CLI 命令参考](./docs/CLI.zh-CN.md) · [配置路径](./docs/CONFIG_PATHS.md) ·
  [ACP 编辑器接入](./docs/ACP.md)
- **功能与排障：** [子智能体 Profile](./docs/SUBAGENT_PROFILES.md) ·
  [Context Engine v2](./docs/SESSION_MEMORY_RETRIEVAL.md) ·
  [能力诊断](./docs/CAPABILITY_DIAGNOSTICS.md) ·
  [恢复与安全模式](./docs/RECOVERY.md) ·
  [Checkpoints 与 rewind](./docs/CHECKPOINTS.md)
- **Agent 预设：** [会话级组合](./docs/AGENT_COMPOSITIONS.zh.md)
- **工程：** [规格](./docs/SPEC.md) ·
  [任务合约与暂停策略](./docs/TASK_CONTRACT.md) ·
  [工具合约](./docs/TOOL_CONTRACT.md)
- **扩展开发：** [扩展概览](./docs/EXTENSIONS.md) ·
  [插件包与 Manifest v1](./docs/PLUGIN_PACKAGES.md) ·
  [Extension Protocol](./docs/EXTENSION_PROTOCOL.md) ·
  [Go SDK 与 starter](./sdk/go/README.md)

## 致谢

引擎、桌面端和本仓库大部分文档来自
[esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix)，MIT 协议。

<p align="center">
  <sub>MIT —— 见 <a href="./LICENSE">LICENSE</a></sub>
</p>
