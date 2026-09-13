# Contributing

Read AGENTS.md and docs/prompts.md first. The v0.2 product contract is silent, read-only review with next-turn advice. Do not reintroduce background repairs or broad prompt injection.

Use Node.js 20.11+ and Git. There are no npm runtime dependencies. Run `npm test` and `npm run check`. `node scripts/smoke-real.mjs` consumes a logged-in Codex account's normal quota and must remain an explicit opt-in check. `node scripts/smoke-cli.mjs` checks the full real CLI workflow using the installed plugin and creates a test conversation. It also consumes account quota; it does not verify the desktop GUI.

The optional macOS wrapper is in plugins/autoreview/native/AutoReview.swift. Build/open it with `npm start` on a Mac with Swift tools. Keep a functioning browser fallback. Preserve model/context, process, snapshot, and hook boundaries in integration tests.

When changing plugin runtime files, use Codex's local plugin update/cachebuster workflow and reinstall; test a new conversation. Do not grant hook trust by editing private state. Describe observed platforms and any unverified host interfaces accurately.
