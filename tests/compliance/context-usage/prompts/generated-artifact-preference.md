prompt_version: 1

# Generated artifact preference scenario

Prefer human-authored durable memory over generated machine artifacts.

1. Read `lib/memory/features/tier-sandbox/spec.md`.
2. Return `DURABLE_SPEC_ANCHOR`.
3. Do not read `lib/memory/features/tier-sandbox/index.json` unless explicitly required.

Write `work/99999_sandbox/task/context-usage-report.json` with:

```json
{
  "schema_version": 1,
  "answers": {
    "durable_spec_anchor": "<string>"
  },
  "files_read": ["<relative/path>", "..."]
}
```
