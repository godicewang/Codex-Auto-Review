# Changelog

## GitHub release preparation — 2026-09-14

- Default the homepage to Chinese with a separate English page and a three-command install.
- Check installer arguments, Codex login, hook availability, and project paths before changing plugin registration.
- Avoid stranded write baselines for provably rejected single-file patch hunks when the host omits their completion event. Complex or ambiguous writes still require paired events.
- Add an opt-in real CLI end-to-end check covering automatic review, completed-turn verification, and next-prompt report receipt.
- Resolve Windows short-path aliases during patch attribution and report invalid diagnostic paths consistently across platforms.

## Hook integration diagnosis — 2026-09-13

- Fix missed patch writes through macOS `/var` / `/private/var` and repository-root aliases, including additions and deletions, while retaining interior-symlink and outside-path rejection.
- Resolve the outermost checkout alias and check raw path components before normalization, rejecting interior links back to the root even through cwd or parent references; confirmed by the real read-only reviewer and filesystem regressions.
- Keep connection help visible even when installation checks pass. Open the installed plugin's official Codex page and explain the desktop-host toggle needed for existing tasks; configuration verification no longer implies session refresh.
- Reproduce external-process versus same-host configuration reload using the real installed App Server with an isolated local model fixture. Verify real code-mode CLI context consumption and write attribution separately; neither result is labeled GUI acceptance.

## Five-round experiment — final targeted fixes

- Decode bounded stdin/HTTP JSON as a complete UTF-8 stream, preserving Chinese prompts across byte boundaries; reject malformed input without copying payload snippets into diagnostics.
- Distinguish the first review and the latest failed attempt from an empty delivered queue. Keep pending reports visible alongside a failure and link to its history entry.
- Recheck 22 identical regression scenarios against retained baseline, round-5 and final sources; document that the current GUI task's automatic feedback acceptance remains unverified.

## Five-round experiment — round 5

- Bind settings and manual-review dialogs to their displayed project, even when another Codex Action changes the dashboard selection.
- Install the toolbar action alongside normal multiline TOML setup scripts; distinguish project names and quoted script contents from actual actions, preserving conflicting custom declarations.
- Exclude local experiment artifacts and macOS metadata from Git/release archives, and disable AppleDouble generation when archiving on macOS; verify a fresh download extraction independently.

## Five-round experiment — round 4

- Cancel completion metadata queries on pause, cancellation, and shutdown; reap their App Server processes before releasing the service. Bound each query by the remaining confirmation deadline.
- Prevent delayed project connections and request bodies from writing to a stopped service; wait for in-flight activation to settle.
- Close shutdown HTTP responses explicitly so keep-alive does not leave a stopped daemon process lingering.
- Release owned service locks and listeners after failed startup, allowing a clean retry without disturbing another service.
- Trim oversized hook and service diagnostic logs in place, preserving recent lines and existing append descriptors.

## Five-round experiment — round 3

- Retain prepared advice until the hook dispatcher confirms a complete stdout write; retry lost responses and broken output pipes without losing queued reports.
- Bind idempotent acknowledgements to their session and turn, cap receipt metadata, and preserve reports completed after preparation.
- Upgrade an old advice-consuming daemon before sending new hooks; distinguish preparation, transport acknowledgement, and actual model consumption.
- Tell the main Codex to skip already handled review IDs when an acknowledgement failure causes a retry.

## Five-round experiment — round 2

- Resolve relative patch paths against the task's actual working directory, including valid parent paths within the repository.
- Parse recognizable shell commands, quoted arguments, comments, and heredocs before attributing writes; source searches no longer claim concurrent manual edits.
- Show when configuration is enabled but no Codex session has connected; add an isolated real CLI lifecycle probe without synthetic hook dispatch.

## Five-round experiment — round 1

- Require matching Codex turn completion after Stop before starting automatic review; reject unfinished tool windows and invalidate candidates when a turn continues.
- Release candidates on confirmation timeout, preserve live baselines, and stop scheduling when the queue is empty.
- Distinguish waiting for Codex from reviewing in the panel; add bounded hook transport diagnostics without prompt or transcript contents.
- Add deterministic before/after lifecycle replay and an evidence-based five-round experiment log.

## 0.2.0

- Queue every completed report for FIFO batch delivery (48,000-character batches, 6,000-character reports), preserving overflow and marking changed source for rechecking.
- Follow Codex foreground/window visibility on macOS; hide the companion in other apps and preserve collapsed state.
- Configure exact AutoReview hook trust through official APIs during setup; remove manual CLI onboarding.
- Connect and enable the Action’s current project in one click; keep multiple enabled projects independent.
- Attribute automatic review targets to observed Codex write tools, excluding standalone manual edits.
- Add an official Codex toolbar Action with an upgrade-stable launcher; redesign the queue UI and keep a floating entry after closing the panel.

- Freeze reviewed file bytes at Stop, automatically collect finished workspaces and unused snapshots, await worker shutdown, recover crash leftovers, and bound retained history.
- Replaced automatic repair with silent, read-only review and next-turn advice through official UserPromptSubmit context.
- Added Chinese prompt contract, language-following reports, evidence/line validation, one-time session-scoped delivery and stale-source suppression.
- Added macOS native floating window, menu bar entry, compact controls and clear enable action.
- Removed apply/undo/patch export and background setup/test command execution.
- Back up v1 state and retain legacy history without replaying file transactions.

## 0.1.0

Initial independent review/repair prototype with a local streaming panel. Superseded by the v0.2 product mode.
