prompt_version: 1

# Simple source-only scenario

This is a source-only task.

1. Read `lib/internal/packages/demo-svc/handler.ts`.
2. Count the number of exported symbols.
3. Do not read `lib/memory/**`, `work/**`, `archive/**`, `lib/inbox/**`, or PRD docs.

Write `work/99999_sandbox/task/context-usage-report.json` with:

```json
{
  "schema_version": 1,
  "answers": {
    "handler_export_count": <number>
  },
  "files_read": ["<relative/path>", "..."]
}
```
