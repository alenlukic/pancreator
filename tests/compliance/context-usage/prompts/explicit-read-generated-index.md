prompt_version: 1

# Explicit read override scenario

This scenario intentionally reads a generated machine artifact by explicit path.

1. Read `lib/memory/features/tier-sandbox/index.json`.
2. Return `generated_machine_anchor`.

Write `work/99999_sandbox/task/context-usage-report.json` with:

```json
{
  "schema_version": 1,
  "answers": {
    "generated_machine_anchor": "<string>"
  },
  "files_read": ["<relative/path>", "..."]
}
```
