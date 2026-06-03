prompt_version: 1

# Summary-first routing scenario

Read only compact product routing inputs.

1. Read `docs/PRD.summary.md` and extract `PRODUCT_ROUTE_TOKEN`.
2. Read `docs/M1.index.md` and extract `M1_INDEX_ANCHOR`.
3. Read `docs/PRD.index.md` and extract `PRD_INDEX_ANCHOR`.
4. Do not read `docs/PRD.md`, `docs/BOOTSTRAP.md`, `archive/**`, `lib/inbox/**`, or handbook paths.

Write `work/99999_sandbox/task/context-usage-report.json` with:

```json
{
  "schema_version": 1,
  "answers": {
    "product_route_token": "<string>",
    "m1_index_anchor": "<string>",
    "prd_index_anchor": "<string>"
  },
  "files_read": ["<relative/path>", "..."]
}
```
