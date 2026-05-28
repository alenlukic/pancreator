---
task_id: 67055_0522_json-formatting
feature_id: json-formatting
pipeline: feature-delivery
stage: implement
slice: B
plan_revision: scope-corrected-round-02
date: 2026-05-23
executor: daedaline-engineer (standard)
---

## Summary vs superseded narrowed-scope pass

The prior trajectory enforced **repository `.json` only** for automated checks and deferred terminal/agent-chat uniformity. Slice A restored the **Round-02 R1 surfaces**: shared canonical formatter, hash abbreviation parity, **`ddl` JSON emitters** (stdout + feature-delivery `state.json`), **compliance YAML + fixture coverage** for Markdown/CLI/chat sketches, and **glossary alignment** showing pretty dual-anchor citations and abbreviated `contentHash` as the canonical stored form. No pre-commit hooks, Cursor rules, or citation-verifier logic were touched.

Slice B executed the required one-shot `.json` migration evidence loop and confirmed the repository was already conformant after Slice A touch-set normalization: both dry-runs returned `wouldRewrite: 0`, and both write-mode passes reported `files rewritten=0`.

## Touch-set deliverables (Slice A)

| Path | Deliverable |
|------|-------------|
| `src/internal/tools/canonical-json-format.mjs` | New shared module: `formatCanonicalJson`, `resolveAbbrevLen`, `abbreviateHashes`, `rewriteJsonText`, formatter constants (`CANONICAL_JSON_INDENT_SPACES`). |
| `src/internal/tools/migrate-json-formatting.mjs` | Delegates formatting to canonical module; dry-run **`console.log`** uses canonical indent; re-exports API for tests/scripts. |
| `tests/compliance/json-formatting.yaml` | Assertions extended for Markdown / terminal / agent-chat/non-.json gates and canonical module path references. |
| `tests/migrate-json-formatting.test.mjs` | Added indent metadata check, canonical fixture parity, forbidden compact-line detector fixture, subprocess dry-run shape, sandbox idempotent dry-loop. |
| `tests/fixtures/json-formatting/*` | Golden CLI/chat JSON + deliberate compact dual-anchor RAW sample for heuristic tests. |
| `src/internal/packages/@daedaline/cli/src/feature-delivery-run.ts` | `state.json` writes via **`stringifyCliJson`** (abbreviate + canonical print). |
| `src/internal/packages/@daedaline/cli/src/run.ts` | All **`emit`** paths stringify via canonical helper (stub + envelopes). |
| `src/internal/packages/@daedaline/cli/src/canonical-json-io.ts` | Thin bridge to **`canonical-json-format.mjs`** (runtime single source). |
| `src/internal/packages/@daedaline/cli/tsconfig.json` | **`allowJs`** + **`include`** canonical `.mjs` so `pnpm --filter @daedaline/cli exec tsc -p tsconfig.json` passes without duplicating formatter TypeScript. |
| `src/internal/packages/@daedaline/cli/src/run.test.ts` | **`DDL_JSON_FORMAT_ABBREV_LEN=7`** in **beforeEach/afterEach** for temp repos without `.git`; JSON layout expectations unchanged aside from deterministic abbrev. |
| `src/memory/handbook/glossary.md` | Dual-anchor glossary examples rewritten to fenced **`json`** blocks with KV-per-line layout; Content hash bullets specify prefix length **`git rev-parse --short HEAD`**. |
| `src/memory/features/json-formatting/index.json` | Stage metadata refreshed for Slice A completion + Slice B deferral pointers. |
| `src/work/.../touch-set.json` | Canonical serialization; **`stage` → `implement`**. |

**Adjacent (not listed in frozen touch-set, required for ergonomics):** `canonical-json-io.ts`, `@daedaline/cli` `tsconfig.json`, `pnpm run build` for `@daedaline/cli` exercised after tsconfig widen.

## Validation

| Command | Exit code | Key output |
|---------|-----------|------------|
| `node src/internal/tools/migrate-json-formatting.mjs --dry-run` | **0** | `abbrevLen=7`, `candidates=144`, `wouldRewrite=0`, `excludeCounts={"tooling_regenerated":0,"vendored_or_dependency_tree":32}` |
| `DAEDALINE_MIGRATION_GO=1 node src/internal/tools/migrate-json-formatting.mjs --write` (pass 1) | **0** | `wouldRewrite=0`, `files rewritten=0` |
| `node src/internal/tools/migrate-json-formatting.mjs --dry-run` (post-write) | **0** | `abbrevLen=7`, `candidates=144`, `wouldRewrite=0` |
| `DAEDALINE_MIGRATION_GO=1 node src/internal/tools/migrate-json-formatting.mjs --write` (pass 2) | **0** | `wouldRewrite=0`, `files rewritten=0` |
| `node --test tests/*.test.mjs` | **0** | `tests=71`, `pass=71`, `fail=0` |
| `node src/internal/tools/check-phase-0a-scaffold.mjs` | **0** | no scaffold drift reported |
| `node src/internal/tools/context-budget-report.mjs` | **0** | report emitted without errors |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh` | **0** | shell syntax valid |

Dry-run summary JSON (both dry-run invocations):

```json
{
  "mode": "dry-run",
  "abbrevLen": 7,
  "candidates": 144,
  "wouldRewrite": 0,
  "excludeCounts": {
    "tooling_regenerated": 0,
    "vendored_or_dependency_tree": 32
  },
  "sampleChanges": []
}
```

## Deferred work

### Slice B — `daedaline-engineer`

- Complete. One-shot migration evidence loop captured with zero rewrites and second-write idempotency proof.
- Optional backlog deferred: Markdown corpus cleanup for lingering compact dual-anchor lines outside controlled fixtures.

### Unchanged deferrals

- **`json-formatting-citation-verifier-prefix`**: verifier still compares full digests; glossary + writers now normalize stored abbreviated `contentHash` per operator direction.
