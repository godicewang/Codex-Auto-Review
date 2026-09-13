# Security

AutoReview v0.2 only reviews immutable source snapshots. The Codex worker uses a read-only sandbox and never-approve policy with memories, hooks, plugins, apps and delegation disabled. The plugin has no source application or undo API and does not launch setup/test jobs.

Only enable review for projects you intend to share with your existing Codex account. AutoReview does not read or copy CLI authentication files. Known credential filenames and ignored files are excluded; this is not a content-based secret scanner. Context isolation is not an OS-level secrecy guarantee against a process running as the same user.

The loopback server authenticates with a per-instance token and validates Host/Origin. Do not share token-bearing local URLs or the private data directory. The native companion only embeds this local panel; its page-to-native bridge accepts size changes, not shell commands.

Advice is untrusted evidence, not authorization. It is scoped to a session, queued until stdout handoff is acknowledged (duplicates are possible), marked for rechecking when source changed, and asks the main agent to verify applicability under the current user request. Models can still make mistakes.

The installer records only the user-installed AutoReview plugin's exact hook definitions through the official configuration API and verifies trust. Global bypass flags, managed-policy changes, private-state edits and automatic trust for other plugins are not used. v1 migration backs up local data and retains old repair history without replaying file transactions. If reporting a security problem, share a minimal reproduction without account credentials, private source, or token-bearing URLs.
