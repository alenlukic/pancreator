You are executing the intake stage for feature-delivery task 20004_1826_us-1-dogfood-phase-4-exit.

Use subagent/persona: intake-analyst

Read first, in this order:
1. AGENTS.md
2. src/work/172990_05-16-26/20004_1826_us-1-dogfood-phase-4-exit/handoff.md
3. The stage input paths listed below

Do not read broad archives, full PRD/bootstrap docs, src/inbox/notes/**, or unrelated src/work/** paths unless the handoff explicitly requires it.

Input: src/inbox/in/us-1-dogfood-phase-4-exit.md
Output: src/memory/features/us-1-dogfood-phase-4-exit/spec.md
Advance after human ratification: pnpm -w exec tess advance 20004_1826_us-1-dogfood-phase-4-exit --artifact src/memory/features/us-1-dogfood-phase-4-exit/spec.md

After the stage artifact is accepted by the human operator, run exactly one matching state command from the handoff instructions. Do not continue to the next persona in the same agent loop.
