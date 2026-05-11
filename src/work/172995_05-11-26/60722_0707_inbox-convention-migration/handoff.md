# Feature delivery handoff — inbox-convention-migration

- Feature id: inbox-convention-migration
- Task id: 60722_0707_inbox-convention-migration
- Pipeline: feature-delivery
- Current stage: intake
- Planner persona: supervisor
- Executor persona: intake-analyst
- Source directive: src/inbox/in/inbox_convention_migration.md
- State file: src/work/172995_05-11-26/60722_0707_inbox-convention-migration/state.json
- Run log: src/work/172995_05-11-26/60722_0707_inbox-convention-migration/run.log.jsonl

## In-scope paths

- src/inbox/in/inbox_convention_migration.md
- src/memory/features/inbox-convention-migration/spec.md
- src/work/<day>/<task-id>/plan.md
- src/work/<day>/<task-id>/adr-draft.md
- src/work/<day>/<task-id>/touch-set.json
- src/work/<day>/<task-id>/review.md
- src/memory/features/inbox-convention-migration/delivery-report.md
- src/inbox/out/<timestamp>-inbox-convention-migration-delivery-report.md

## Explicit non-goals

- Do not read or write src/inbox/notes/.
- Do not continue past a human gate without explicit ratification.
- Do not push, open a PR, or commit without the human operator.
- Do not carry planning context into implementation; pass this handoff path instead.

## Validation commands

- node --test tests/*.test.mjs
- node src/internal/tools/check-phase-0a-scaffold.mjs
- node src/internal/tools/context-budget-report.mjs
- bash -n .cursor/hooks/enforce-policy-compliance.sh

## Re-entry rule

If scope changes, validation repeatedly fails, or the touch-set is incomplete, stop and delegate back to supervisor, tech-lead, or reviewer instead of extending the executor loop.

## Directive excerpt

```markdown
- Migrate `inbox` to follow the same naming and organizational conventions as `work` (i.e. day-oriented top-level directories, HHMM-oriented subdirectories, ensuring reverse chron order using future anchor prefixes, descriptive suffixes)
```
