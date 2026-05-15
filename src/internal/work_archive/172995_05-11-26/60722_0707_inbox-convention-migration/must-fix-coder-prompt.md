You are implementing must-fix corrections for this feature-delivery task.

Primary handoff:
src/work/172995_05-11-26/60722_0707_inbox-convention-migration/next-prompt.md

Feature spec:
/spec.md

Failed review artifact:
src/work/172995_05-11-26/60722_0707_inbox-convention-migration/review.failed-before-mustfix.md

Scope lock:
Only address these must-fix items:

1. Fix standalone inbox migration write safety.
   - In src/internal/tools/migrate-inbox-convention.mjs, standalone write mode must not recompute a fresh plan and directly apply it.
   - Either require an approved persisted manifest path and apply exactly that mapping, or disable standalone --write and route writes through the combined timestamp migration approved-manifest path.
   - Preserve rollback/inversion safety.

2. Fix or justify legacy thread discovery coverage.
   - Current concern: discovery may only cover src/inbox/threads/<feature>/<file>.
   - Make discovery safely recursive for legacy thread directories if needed.
   - Do not traverse src/inbox/notes.
   - Do not remigrate already-migrated day/task-shaped thread paths.

3. Capture implementation evidence.
   - Write a concise implementation report to:
     src/work/172995_05-11-26/60722_0707_inbox-convention-migration/implementation-report.md
   - Include changed files, summary of fixes, and any known caveats.

Do not perform unrelated refactors.
Do not rewrite broad docs unless directly necessary.
Do not advance the pipeline yourself.
