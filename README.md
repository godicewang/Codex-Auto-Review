# Codex AutoReview Plugin

中文 · [English](README.en.md)

<img src="docs/assets/reviewer-face.png" alt="歪着眉毛检查代码的小人脸" width="112" align="right">

你可能习惯让 Codex 改代码，再交给 Cursor、Gemini 或另一个 agent review。每改完一轮，都要切工具、说明需求，再把审查意见搬回来，来回很费时间。

AutoReview 是一个 Codex 插件，把这一步自动化：一轮代码改动结束后，另开一个独立、只读的 Codex 会话检查变更。报告完成后，随你在同一任务中的下一条消息交给主 Codex 核对。审查过程不修改源码。

## 为什么用

- **少打断**：后台静默审查，你照常开发，需要时再看面板。
- **控制 token 开销**：不复制整段主对话，也不回传审计过程，只交回简短报告。审计本身仍会消耗 Codex 额度。
- **开启后自动审**：安装并开启项目后，后续审计自动触发。不用再配一个 review agent，也不需要额外 API key。

## 安装

需要 **Node.js 20.11+、Git，以及已登录、支持 plugins / hooks / App Server 的 Codex**。

```sh
git clone https://github.com/godicewang/Codex-Auto-Review.git
cd Codex-Auto-Review
npm run setup
```

无需 `npm install`。也可以 [下载 ZIP](https://github.com/godicewang/Codex-Auto-Review/archive/refs/heads/main.zip)，解压后在文件夹中运行 `npm run setup`。

## 开始使用

在 Codex 中打开**你要审计的 Git 项目**，新建任务，发送：

> 使用 AutoReview，打开悬浮窗，并开启当前项目的只读审计。

之后照常开发。面板可以查看报告、暂停审计，也可从任务顶部 **Actions → AutoReview** 打开。

macOS 使用悬浮窗；缺少 Swift 编译工具时改用网页面板。Windows / Linux 使用网页面板，真实桌面接入尚未验证。

旧任务没有反应时，新建任务或在 Codex 插件页将 AutoReview 关闭再开启。要暂停审计，请关掉面板中的项目开关；关闭窗口不会暂停。

## 更新与卸载

更新：在本仓库目录执行 `git pull --ff-only`，再运行 `npm run setup`，随后使用新的 Codex 任务。

卸载：执行 `npm run setup -- --uninstall`。本地审计历史保留在 `~/.autoreview`。

[详细说明](README.zh-CN.md) · [接入排查](docs/hook-troubleshooting.md) · [兼容性与验证](docs/compatibility.md) · [数据与安全](SECURITY.md) · [MIT License](LICENSE)

社区项目，与 OpenAI 官方的权限审批 Auto-review 功能无关。
