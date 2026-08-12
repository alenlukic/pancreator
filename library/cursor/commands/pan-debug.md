Investigate the problem described by `$ARGUMENTS` without implementing a fix.

1. Read `AGENTS.md` and preserve `$ARGUMENTS` verbatim in a uniquely named file under `runtime/inbox/` as the investigation input.
2. Run `./bin/pan governance card --mode investigation --request <harness-relative-input>` and read the card it writes. It resolves the complete investigation governance, including `DIAG-001` and `WORK-001`; do not assemble policy text by hand. When the operator names a worktree, add `--worktree <name>` to create or resolve it. The card then binds the session workspace to that worktree.
3. Invoke the `pan-investigator` subagent, pasting the complete card contents verbatim into its prompt followed by the preserved input. Require it to identify root cause, propose remediation with numbered acceptance criteria, and recommend exactly one work mode: `lightweight` or `systematic`.
4. Do not modify source or workflow state.
5. Surface the investigator's complete output in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
