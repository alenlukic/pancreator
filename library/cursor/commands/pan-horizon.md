Start or inspect a long-horizon session from `$ARGUMENTS`.

A long-horizon session is driven by the harness, not by this chat and not by an agent supervisor. Each task runs in a fresh headless driver process that reads the durable session and latest handoff.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`.
2. For each task run, the fresh driver process runs `{{PANCREATOR_PAN_COMMAND}} governance card --mode supervisor --run <run-id>` as its first run action, reads the card, and attests it under the preflight authorization. Do not run that per-run step in this chat.
3. Require `$ARGUMENTS` to name a queue file with `--queue <path>`. Preserve a named worktree with the exact forwarding form `horizon init --queue <path> --worktree <name> --json`. Preserve a named `--involvement <profile>` option.
4. Run `{{PANCREATOR_PAN_COMMAND}} horizon init --queue <path> [--worktree <name>] [--involvement <profile>] --json`.
5. Run `{{PANCREATOR_PAN_COMMAND}} horizon start <session-id> --attest-supervisor-card --json`. This preflight authorization is explicit and applies only to that session.
6. Report the terminal or empty session state, deferred task ids, ledger path, latest handoff path, and the post-run action.
7. Do not launch a supervisor agent or supervise a task in this chat. The only continuity boundary is the new driver process that reads the handoff.
