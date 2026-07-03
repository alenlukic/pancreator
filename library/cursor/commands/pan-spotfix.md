Apply lightweight remediation to `$ARGUMENTS`.

1. Read `AGENTS.md`, `library/personas/spotfixer.md`, `governance/policies/SPOT-001.json`, and `library/skills/spotfix.md`; preserve `$ARGUMENTS` verbatim as the spotfix input.
2. Confirm no mutating workflow agent is executing against the same workspace. If one is, stop and tell the operator to terminate it before retrying.
3. Invoke the `spotfixer` subagent with the preserved input. Inline the complete resolved `SPOT-001` policy and spotfix procedure into the delegated prompt; a path reference is not a substitute. The subagent MUST apply the inlined eligibility checks, acceptance criteria, proportionate tests, at most three implementation-validation cycles, and systematic escalation rules.
4. Do not commit, push, merge, publish, deploy, or invoke `pan set-stage`.
5. Surface the spotfixer's complete outcome in the chat inside one fenced `markdown` block so it is directly copyable. Do not rewrite or summarize it outside the block.
