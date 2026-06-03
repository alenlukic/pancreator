You are executing the review stage for feature-delivery task `99999_0000_fd-skeleton`.

Use subagent/persona: reviewer

Read first, in this order:
1. `AGENTS.md`
2. `pipeline/99999_sandbox/task/handoff.md`
3. `pipeline/99999_sandbox/task/implementation-report.md`
4. `pipeline/99999_sandbox/task/touch-set.json`

Read-only allowlist for this stage:
- `AGENTS.md`
- `pipeline/99999_sandbox/task/handoff.md`
- `pipeline/99999_sandbox/task/implementation-report.md`
- `pipeline/99999_sandbox/task/touch-set.json`
- `lib/internal/packages/demo-svc/handler.ts`
- `pipeline/99999_sandbox/task/review-report.md` (write target check only)

Do not read any other files or directories.

Focus on correctness risks and regression surface in `lib/internal/packages/demo-svc/handler.ts`.

Write or update: `pipeline/99999_sandbox/task/review-report.md`.
