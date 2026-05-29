You are executing the intake stage for feature-delivery task 69218_0446_v0-ui-dashboard-subordinate-feature-pipeline-qa.

Use subagent/persona: intake-analyst

Read first, in this order:
1. AGENTS.md
2. src/work/172977_05-29-26/69218_0446_v0-ui-dashboard-subordinate-feature-pipeline-qa/handoff.md
3. The stage input paths listed below

Do not read broad archives, full PRD/bootstrap docs, src/inbox/notes/**, or unrelated src/work/** paths unless the handoff explicitly requires it.

Input: src/inbox/in/172977_05-29-26/70345_0427_v0-ui-dashboard-subordinate-feature-pipeline-qa.md
Output: src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md
Advance after human ratification: pnpm -w exec ddl advance 69218_0446_v0-ui-dashboard-subordinate-feature-pipeline-qa --artifact src/memory/features/v0-ui-dashboard-subordinate-feature-pipeline-qa/spec.md

After the stage artifact is accepted by the human operator, run exactly one matching state command from the handoff instructions. Do not continue to the next persona in the same agent loop.
