# AutoReview

中文 · [English](README.en.md)

Codex 的后台代码审计插件。一轮代码修改结束后，AutoReview 在独立的只读会话中检查变更；报告完成后，随你在同一任务中的下一条消息交给 Codex 核对。

后台只检查和给建议，不修改源码。你可以继续开发，不必等审计完成。

## 安装

需要 **Node.js 20.11+、Git，以及已登录、支持 plugins / hooks / App Server 的 Codex**。审计使用现有 Codex 账号的额度，无需额外 API key。

```sh
git clone https://github.com/godicewang/Codex-Auto-Review.git
cd Codex-Auto-Review
npm run setup
```

无需 `npm install`。也可以 [下载 ZIP](https://github.com/godicewang/Codex-Auto-Review/archive/refs/heads/main.zip)，解压后在文件夹中运行 `npm run setup`。

## 开始使用

在 Codex 中打开**你要审计的 Git 项目**，新建任务，发送：

> 使用 AutoReview，打开悬浮窗，并开启当前项目的只读审计。

之后正常开发即可。面板可以查看报告、暂停审计；连接后也可从任务顶部 **Actions → AutoReview** 打开。

macOS 提供随 Codex 显示的悬浮窗；缺少 Swift 编译工具时使用网页面板。Windows / Linux 使用网页面板，平台集成仍待验证。

安装后旧任务没有反应：新建任务，或在 Codex 插件页将 AutoReview 关闭再开启。关闭面板不会暂停审计，请使用项目开关。

## 更新与卸载

更新：在本仓库目录执行 `git pull --ff-only`，再运行 `npm run setup`，随后使用新的 Codex 任务。

卸载：执行 `npm run setup -- --uninstall`。本地审计历史保留在 `~/.autoreview`。

[详细说明](README.zh-CN.md) · [接入排查](docs/hook-troubleshooting.md) · [兼容性与验证](docs/compatibility.md) · [数据与安全](SECURITY.md) · [MIT License](LICENSE)

社区项目，与 OpenAI 官方的权限审批 Auto-review 功能无关。
