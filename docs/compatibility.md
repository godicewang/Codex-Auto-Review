# Compatibility — v0.2

Locally tested on macOS with Node.js 23.11.0, Git 2.50.1 and Codex CLI `0.154.0-alpha.6.2`. The native shell compiled with the installed Swift toolchain using an explicit macOS SDK and macOS 13 deployment target. The floating AppKit panel, local WKWebView, enable toggle and compact resize were exercised through the actual native app.

## Official Codex integration

- `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `Interrupt`, `SessionEnd` bundled in `hooks/hooks.json`.
- `UserPromptSubmit` provides the user prompt and session/turn IDs; its `hookSpecificOutput.additionalContext` supplies extra model-visible developer context. It does not rewrite the visible user input or guarantee ordering before that message.
- `.codex-plugin/plugin.json`, a repo marketplace and `.mcp.json`. The legacy MCP loader resolves `cwd:"./"` relative to the installed plugin, so the package uses `args:["./bin/mcp.mjs"]`. The newer root manifest format did not load hooks on this alpha and is not shipped.
- Official App Server stdio: existing CLI auth, ephemeral thread, read-only sandbox, disabled memories and hooks. No API key parsing or private session database scraping.

The installer configures only the installed AutoReview hook definitions via official `hooks/list` and `config/batchWrite` (`hooks.state.<key>.trusted_hash` / `enabled`) and verifies them. No manual interactive CLI setup, global bypass, managed-policy edits, private database changes or other-plugin trust writes. New conversations pick up upgraded definitions. Existing sessions need a configuration reload in their own host; an external installer's reload is insufficient on the tested version. Codex's plugin toggle issues that same-host reload. The companion links to the official plugin page and explains the required toggle; it does not claim to refresh the desktop host itself. This behavior was reproduced with the installed App Server and a local model protocol fixture; it is not a real GUI end-to-end result.

macOS absolute patch paths may use `/var` while Git reports `/private/var`. Attribution resolves aliases of the repository root while preserving rejection of symlinks inside the checkout. Real code-mode CLI writes exposed and verified this fix.

## Interface and platforms

A public API for third-party persistent native Codex chat sidebar registration has not been confirmed in the official plugin UI documentation. The macOS companion is a separate native floating window and menu bar item, not a modification of Codex. The same local panel can open in Codex's browser pane when the host exposes that tool.

The macOS companion is optional; missing Swift build tools fall back to the browser. Linux/Windows use the web panel and remain platform integration targets. The included CI matrix targets Node 20/22 on macOS/Linux/Windows; remote CI has not run in this local session. App Server remains experimental in the tested CLI.

Sources checked on 2026-09-12: [Hooks](https://learn.chatgpt.com/docs/hooks), [App Server](https://learn.chatgpt.com/docs/app-server), [Plugin packaging](https://developers.openai.com/plugins/build/plugins), [Plugin UI](https://developers.openai.com/plugins/build/chatgpt-ui).

The toolbar Action passes its actual working directory to the stable launcher, which connects/enables that project. No public focused-project API was found for the standalone companion, so it does not scrape UI/session databases or infer focus from recent activity. macOS visibility uses NSWorkspace foreground notifications and visible-window ownership/geometry without titles, screenshots or Accessibility permissions. `visibility.json` contains only the companion display mode for diagnostics.
