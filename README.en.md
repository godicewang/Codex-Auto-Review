# Codex AutoReview Plugin

[中文](README.md) · English

<img src="docs/assets/reviewer-face.png" alt="A skeptical little face checking your code" width="112" align="right">

You might use Codex to write code, then ask Cursor, Gemini, or another agent to review it. After each round, you switch tools, explain the task again, and bring the feedback back. That gets tedious.

AutoReview is a Codex plugin that handles this handoff. After a coding turn finishes, it starts a separate, read-only Codex session to check the changes. Completed reports reach the main Codex conversation with your next message in the same task for verification. The reviewer never edits your source.

## Why use it

- **Fewer interruptions.** Reviews run quietly in the background while you keep coding.
- **Less repeated context.** It skips the full conversation and returns a short report without review chatter. Reviews still consume Codex tokens and account quota.
- **Automatic after setup.** Install it, enable your project, and later reviews start automatically. No separate review agent or extra API key to configure.

## Install

Requires **Node.js 20.11+, Git, and a signed-in Codex with plugins, hooks, and App Server support**.

```sh
git clone https://github.com/godicewang/Codex-Auto-Review-Plugin.git
cd Codex-Auto-Review-Plugin
npm run setup
```

No `npm install` needed. You can also [download the ZIP](https://github.com/godicewang/Codex-Auto-Review-Plugin/archive/refs/heads/main.zip), extract it, and run `npm run setup` in that folder.

## Use

Open **the Git project you want to review** in Codex, start a new task, and send:

> Use AutoReview to open the panel and enable read-only review for this project.

Keep coding as usual. The panel lets you read reports and pause reviews. Open it again from **Actions → AutoReview** in the task toolbar.

On macOS, use the floating window, or the web panel if Swift build tools are unavailable. Windows and Linux use the web panel; their real desktop integration is not yet verified.

If an old task doesn't respond, start a new one or toggle AutoReview off and on in Codex's plugin page. To pause reviews, turn off the project switch in the panel. Closing the window doesn't pause them.

## Update or uninstall

To update, run `git pull --ff-only` in this repository, then `npm run setup`, and use a new Codex task.

To uninstall, run `npm run setup -- --uninstall`. Local review history stays in `~/.autoreview`.

[Usage details](docs/usage.en.md) · [Troubleshooting](docs/hook-troubleshooting.md) · [Compatibility](docs/compatibility.md) · [Data and security](SECURITY.md) · [MIT License](LICENSE)

Community project. Not affiliated with OpenAI or its permission-approval Auto-review feature.
