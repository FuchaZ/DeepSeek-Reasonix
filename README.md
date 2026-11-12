<p align="center">
  <img src="docs/logo-ghost-wave-effect.svg" alt="Reasonix" width="360"/>
</p>

> [!NOTE]
> **Reasonix Studio Tweaks** — a personal fork of [DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix) on the `studio` (2.x) line. Upstream stopped at v2.61.0; this fork continues from there, focused on the Reasonix Studio desktop app: UI layout, small features and small bug fixes.

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="./README.zh-CN.md">简体中文</a>
  &nbsp;·&nbsp;
  <a href="./docs/GUIDE.md">Guide</a>
  &nbsp;·&nbsp;
  <a href="./docs/ACP.md">ACP</a>
  &nbsp;·&nbsp;
  <a href="./docs/EXTENSIONS.md">Extensions</a>
  &nbsp;·&nbsp;
  <a href="./docs/SPEC.md">Spec</a>
</p>

<br/>

## What this fork changes

This fork is **Reasonix Studio Tweaks**. The engine is kept as upstream left it; the work lands in Reasonix Studio, the desktop app:

- **UI layout.** The workbench, panes and prompt area are rearranged so the conversation and the project tree get more of the window and the chrome gets less.
- **Small features.** Small conveniences that make the app nicer to live in, added one at a time.
- **Small bug fixes.** Narrow defects in the desktop shell and the web UI, fixed one at a time, each with the test that covers it.

Changes stay small and reviewable. Nothing here is a rewrite. Multi-agent work is on the same branch, but it is not what this fork is named for.

## Versions

This fork starts at **v2.6.1** and moves forward inside the `2.6.x` line: each release bumps the patch number — 2.6.1, 2.6.2, 2.6.3, and so on. There is no jump to 2.7; new behaviour ships as `2.6.x` patches.

Releases are published from this repository's own [releases page](https://github.com/Oliver-Rui/Reasonix-Studio-Tweaks/releases). v2.61.0 remains the last upstream release.

## Install

Reasonix Studio is the desktop app; the CLI, Studio and the editor integrations all run the same local Reasonix engine.

Build it from source:

```sh
git clone https://github.com/Oliver-Rui/Reasonix-Studio-Tweaks.git
cd Reasonix-Studio-Tweaks
git switch studio
```

### CLI

The CLI build requires **Go 1.26+**. The module pins a `toolchain` directive;
keep `GOTOOLCHAIN=auto` so Go downloads the pinned toolchain, or install it.

```sh
make build      # -> bin/reasonix(.exe)
make cross      # -> dist/ (darwin|linux|windows × amd64|arm64)
```

### Studio

Studio additionally requires **Node 24+ and pnpm 10**
(`npm install -g pnpm@10`) for the frontend.

```sh
make studio
```

See the [Studio build guide](desktop/README.md#prerequisites) for platform
webview dependencies and Linux build tags.

## Quick start

### Reasonix Studio

Install and launch Studio, then connect a provider and model in the app. No CLI
setup is needed.

### CLI / TUI

```sh
reasonix setup                      # configure a provider and model
reasonix                            # start an interactive session
reasonix run "implement the TODOs in main.go"
```

In an interactive session, run `/init` when you want Reasonix to create project
instructions.

For advanced CLI usage and configuration, see the **[CLI reference](./docs/CLI.md)**,
**[Guide](./docs/GUIDE.md)**, and
**[configuration paths](./docs/CONFIG_PATHS.md)**.

## Documentation

- **Getting started:** [Guide](./docs/GUIDE.md) · [CLI reference](./docs/CLI.md) ·
  [Configuration paths](./docs/CONFIG_PATHS.md) · [ACP editor integration](./docs/ACP.md)
- **Features & troubleshooting:** [Subagent profiles](./docs/SUBAGENT_PROFILES.md) ·
  [Context Engine v2](./docs/SESSION_MEMORY_RETRIEVAL.md) ·
  [Capability diagnostics](./docs/CAPABILITY_DIAGNOSTICS.md) ·
  [Recovery and updates](./docs/RECOVERY.md) ·
  [Checkpoints & rewind](./docs/CHECKPOINTS.md)
- **Agent presets:** [Session Agent compositions](./docs/AGENT_COMPOSITIONS.md)
- **Engineering:** [Spec](./docs/SPEC.md) ·
  [Task contracts & pause policy](./docs/TASK_CONTRACT.md) ·
  [Tool contract](./docs/TOOL_CONTRACT.md)
- **Extension development:** [Skills](./docs/SKILLS.md) · [Extensions](./docs/EXTENSIONS.md) ·
  [Plugin packages and Manifest v1](./docs/PLUGIN_PACKAGES.md) ·
  [Extension Protocol](./docs/EXTENSION_PROTOCOL.md) ·
  [Go SDK and starter](./sdk/go/README.md)

## Credits

Engine, desktop app and most of this documentation come from
[esengine/DeepSeek-Reasonix](https://github.com/esengine/DeepSeek-Reasonix), under the MIT license.

<p align="center">
  <sub>MIT — see <a href="./LICENSE">LICENSE</a></sub>
</p>
