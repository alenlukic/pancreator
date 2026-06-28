Investigate the problem described by `$ARGUMENTS` without implementing a fix.

1. Read `AGENTS.md` and preserve `$ARGUMENTS` verbatim as the investigation input.
2. Invoke the `investigator` subagent with that input.
3. Require the investigator to apply `WORK-001`, identify root cause, propose remediation with numbered acceptance criteria, and recommend exactly one work mode: `lightweight` or `systematic`.
4. Do not modify source or workflow state.
5. Surface the investigator's complete output in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
