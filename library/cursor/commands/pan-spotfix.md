Apply lightweight remediation to `$ARGUMENTS`.

1. Read `{{PANCREATOR_HARNESS_PATH}}AGENTS.md`. Preserve `$ARGUMENTS` verbatim in a uniquely named file under `{{PANCREATOR_HARNESS_PATH}}runtime/inbox/queue/` as the spotfix input.
2. Confirm no mutating workflow agent runs against the same workspace. If one runs, stop and tell the operator to end it before retrying.
3. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode spotfix --request <harness-relative-input>` and read the card it writes. It resolves the complete spotfix governance, including `SPOT-001` and its reference to the spotfix procedure. Read that reference. Do not assemble policy text by hand. When the operator names a worktree, add `--worktree <name>` to create or resolve it. The card then binds the session workspace to that worktree.
4. Invoke the `pan-spotfixer` subagent, pasting the complete card contents verbatim into its prompt followed by the preserved input. A path reference is not a substitute for the card body. The subagent MUST apply the inlined eligibility checks, acceptance criteria, proportionate tests, at most three implementation-validation cycles, and systematic escalation rules.
5. Do not push, publish, deploy, or invoke `pan set-stage`.
6. Surface the spotfixer's complete outcome in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
