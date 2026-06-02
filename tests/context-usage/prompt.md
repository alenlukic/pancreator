prompt_version: 1

# Context usage bounded task (frozen)

Execute exactly these steps in order. Do not read `docs/PRD.md` or `docs/BOOTSTRAP.md`. Do not explore `archive/` or `lib/inbox/`.

1. Read `lib/memory/active/current.md` and record the `ACTIVE_FEATURE` anchor value in your answers.
2. Read `lib/memory/handbook/routing.md` and record the `HANDBOOK_ANCHOR_ALPHA` anchor value.
3. Read `docs/PRD.summary.md` (not the full PRD) and record the `PRODUCT_ROUTE_TOKEN` anchor.
4. Read `work/99999_sandbox/task/handoff.md` and record the `HANDOFF_STAGE` anchor.
5. Read `lib/internal/packages/demo-svc/handler.ts` and count exported symbols (integer).

Write `work/99999_sandbox/task/context-usage-report.json` with this schema:

```json
{
  "schema_version": 1,
  "answers": {
    "active_feature": "<string>",
    "handbook_anchor": "<string>",
    "product_route_token": "<string>",
    "handoff_stage": "<string>",
    "handler_export_count": <number>
  },
  "files_read": ["<relative/path>", "..."]
}
```
