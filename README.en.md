# AutoReview

[中文](README.md) · English

Background code review for Codex. After a coding turn finishes, AutoReview checks the changes in a separate, read-only session. Completed reports reach Codex with your next message in the same task for verification.

The reviewer suggests fixes without editing your source. You can keep working while it runs.

## Install

Requires **Node.js 20.11+, Git, and a signed-in Codex with plugins, hooks, and App Server support**. Reviews use your existing Codex account quota. No extra API key is needed.

```sh
git clone https://github.com/godicewang/Codex-Auto-Review.git
cd Codex-Auto-Review
npm run setup
```

No `npm install` needed. You can also [download the ZIP](https://github.com/godicewang/Codex-Auto-Review/archive/refs/heads/main.zip), extract it, and run `npm run setup` in that folder.

## Use

Open **the Git project you want to review** in Codex, start a new task, and send:

> Use AutoReview to open the panel and enable read-only review for this project.

Keep coding as usual. Use the panel to read reports or pause reviews. Once connected, **Actions → AutoReview** in the task toolbar opens the panel.

On macOS, a floating window follows Codex. Without Swift build tools, setup uses the web panel. Windows and Linux use the web panel; platform integration testing is still pending.

If an existing task does not respond after installation, start a new task or toggle AutoReview off and on in Codex's plugin page. Closing the panel does not pause reviews; use the project switch.

## Update or uninstall

To update, run `git pull --ff-only` in this repository, then `npm run setup`, and use a new Codex task.

To uninstall, run `npm run setup -- --uninstall`. Local review history stays in `~/.autoreview`.

[Usage details](docs/usage.en.md) · [Troubleshooting](docs/hook-troubleshooting.md) · [Compatibility](docs/compatibility.md) · [Data and security](SECURITY.md) · [MIT License](LICENSE)

Community project. Not affiliated with OpenAI or its permission-approval Auto-review feature.
