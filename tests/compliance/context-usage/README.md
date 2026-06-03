# Compliance mirror: context-usage

This directory is the canonical context-usage harness root in this repository.

Legacy references to `tests/context-usage/` may appear in older artifacts; prefer
`tests/compliance/context-usage/` for all current operator and agent workflows.

## Canonical commands

```bash
cd "/Users/alen/Dev/daedaline"
pnpm run context:usage:test
pnpm run context:usage:fd-trace -- --trace tests/compliance/context-usage/traces/fd-skeleton/implement.context.json --model composer-2.5 --debug-context
pnpm run context:usage:fd-trace:ratify -- --quantile 0.9 --confidence 0.8 --min-runs 3 tests/compliance/context-usage/output/<report-1>.json tests/compliance/context-usage/output/<report-2>.json tests/compliance/context-usage/output/<report-3>.json
```
