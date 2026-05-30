# Delivery Report — json-formatting

## Summary

The json-formatting feature ships a canonical JSON formatting policy across all Round-02 R1
surfaces: repository `.json` artifacts, Markdown-embedded JSON, terminal/CLI output from
`pan`, and agent-chat JSON sketches. A shared canonical formatter module
(`lib/internal/tools/canonical-json-format.mjs`) provides `formatCanonicalJson`,
`resolveAbbrevLen`, `abbreviateHashes`, and `rewriteJsonText`; the bulk migration script and
CLI emitters each delegate to this single source. Abbreviation length derives from
`git rev-parse --short HEAD` at write time.

The migration evidence loop confirms the repository was already conformant after Slice A
touch-set normalization: both dry-run invocations reported `candidates=144`, `wouldRewrite=0`,
and both guarded write-mode passes returned `files rewritten=0`.

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

The compliance test suite reports 71 passing tests. Review verdict is pass for both Slice A
and Slice B.

```json
{
  "kind": "lines",
  "path": "work/172983_05-23-26/67055_0522_json-formatting/implementation-report.md",
  "range": [13, 16],
  "contentHash": "514098b"
}
```

```json
{
  "kind": "lines",
  "path": "work/172983_05-23-26/67055_0522_json-formatting/review.md",
  "range": [3, 4],
  "contentHash": "bd00fb1"
}
```

## Architecture

- Policy-first compliance descriptor lands before any mass rewrite so legacy JSON does not fail
the new rule set during migration. The compliance YAML adds assertion coverage for
Markdown/terminal/agent-chat surfaces beyond the prior repo-file-only scope.
  ```json
  {
    "kind": "lines",
    "path": "tests/compliance/json-formatting.yaml",
    "range": [1, 35],
    "contentHash": "c2a76e8"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/adr-draft.md",
    "range": [47, 58],
    "contentHash": "61ffd6b"
  }
  ```
- Slice A (`coder`) lands the shared formatter module (`canonical-json-format.mjs`), CLI emitter
alignment (`canonical-json-io.ts`, `feature-delivery-run.ts`, `run.ts`), glossary update to
specify abbreviated `contentHash` as the canonical stored form, compliance descriptor
extension, test and fixture additions.
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/implementation-report.md",
    "range": [18, 35],
    "contentHash": "514098b"
  }
  ```
- Slice B (`pancreator-engineer`) executes the one-shot `.json` bulk migration evidence loop.
Because Slice A left the in-scope `.json` corpus conformant, first and second guarded write
passes each reported zero rewrites, confirming idempotency without side effects.
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/implementation-report.md",
    "range": [40, 65],
    "contentHash": "514098b"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/review.md",
    "range": [38, 52],
    "contentHash": "bd00fb1"
  }
  ```
- Deferred: citation-verifier prefix-comparison logic is a companion feature
(`json-formatting-citation-verifier-prefix`). The verifier still compares full digests;
glossary and writers normalize stored abbreviated `contentHash` per operator direction.
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/adr-draft.md",
    "range": [55, 57],
    "contentHash": "61ffd6b"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "lib/memory/features/json-formatting/spec.md",
    "range": [149, 163],
    "contentHash": "224781e"
  }
  ```

## Interfaces

- `resolveAbbrevLen(repoRoot)` in `canonical-json-format.mjs` derives abbreviation length from
the `PAN_JSON_FORMAT_ABBREV_LEN` env override (decimal digits, 4–255) or from
`git rev-parse --short HEAD` at runtime. This function is the single source for all
abbreviation length decisions.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/canonical-json-format.mjs",
    "range": [25, 55],
    "contentHash": "5c12707"
  }
  ```
- `abbreviateHashes(root, abbrevLen)` deep-clones the value tree and shortens `contentHash`
and bare-hex SHA-1/SHA-256 strings to `abbrevLen` characters. It is key-aware: `contentHash`
fields accept SHA-256 or SHA-1 lengths; other fields accept any full-length hex string.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/canonical-json-format.mjs",
    "range": [99, 127],
    "contentHash": "5c12707"
  }
  ```
- `formatCanonicalJson(value, depth)` emits canonical pretty-print: 2-space indent, one object
key-value pair per line, primitive-only arrays inlined up to 96 characters, object arrays
expanded to multiline form.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/canonical-json-format.mjs",
    "range": [134, 152],
    "contentHash": "5c12707"
  }
  ```
- `rewriteJsonText(text, abbrevLen)` composes parse → `abbreviateHashes` → `formatCanonicalJson`
→ trailing newline and reports `{ changed: boolean, output: string }`. It is idempotent: a
second pass on already-canonical output returns `changed: false`.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/canonical-json-format.mjs",
    "range": [218, 224],
    "contentHash": "5c12707"
  }
  ```
- CLI `stringifyCliJson(repoRoot, value)` in `@pancreator/cli/lib/canonical-json-io.ts` is the
thin bridge that calls `resolveAbbrevLen`, `abbreviateHashes`, and `formatCanonicalJson` to
serialize all `pan` terminal output and `state.json` writes.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/packages/@pancreator/cli/lib/canonical-json-io.ts",
    "range": [7, 12],
    "contentHash": "0ea7b62"
  }
  ```
- Migration `runMigration({ repoRoot, write })` in `migrate-json-formatting.mjs` delegates to
`collectRepoJson` and `rewriteJsonText`; returns `{ candidates, rewritten, unchanged, excludeCounts }`. The CLI entry-point emits the dry-run summary shape
`{ mode, abbrevLen, candidates, wouldRewrite, excludeCounts, sampleChanges }` via
`formatCanonicalJson`.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/migrate-json-formatting.mjs",
    "range": [126, 153],
    "contentHash": "081c2c1"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/migrate-json-formatting.mjs",
    "range": [214, 226],
    "contentHash": "081c2c1"
  }
  ```

## Tradeoffs

- Enforcement stays in `tests/compliance/` only; no pre-commit hooks and no Cursor-rule gates
were added. This keeps one automated boundary and avoids cross-tool state management
complexity.
  ```json
  {
    "kind": "lines",
    "path": "lib/memory/features/json-formatting/spec.md",
    "range": [140, 144],
    "contentHash": "224781e"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/adr-draft.md",
    "range": [54, 55],
    "contentHash": "61ffd6b"
  }
  ```
- Abbreviated `contentHash` values are stored now; the citation-verifier prefix-comparison
behavior is deferred to companion feature `json-formatting-citation-verifier-prefix`. Scope
stays bounded while a follow-on feature remains queued.
  ```json
  {
    "kind": "lines",
    "path": "lib/memory/features/json-formatting/spec.md",
    "range": [149, 163],
    "contentHash": "224781e"
  }
  ```
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/adr-draft.md",
    "range": [64, 70],
    "contentHash": "61ffd6b"
  }
  ```
- The `--write` path requires `PANCREATOR_MIGRATION_GO=1`, preventing accidental mutation in
sandboxed or CI runs at the cost of one explicit operator action per write execution.
  ```json
  {
    "kind": "lines",
    "path": "lib/internal/tools/migrate-json-formatting.mjs",
    "range": [178, 186],
    "contentHash": "081c2c1"
  }
  ```
- The write-loop acceptance is technically vacuous for this run because Slice A normalization
left the corpus already conformant (`wouldRewrite=0` before the first write pass). The
evidence chain is nonetheless internally consistent and forms the canonical idempotency proof
for future runs.
  ```json
  {
    "kind": "lines",
    "path": "work/172983_05-23-26/67055_0522_json-formatting/review.md",
    "range": [64, 68],
    "contentHash": "bd00fb1"
  }
  ```

## Usage guidelines

1. Import `rewriteJsonText` from `canonical-json-format.mjs` to canonicalize any JSON
  string; the function shortens full-length hex hashes and reformats in a single call.
2. Call `stringifyCliJson(repoRoot, value)` from `@pancreator/cli` for all `pan` terminal
  and `state.json` outputs; it wires `resolveAbbrevLen` so the abbreviation length is always
   derived from the live repo at write time.
3. Set `PAN_JSON_FORMAT_ABBREV_LEN=7` in test environments that operate without a `.git`
  directory; tests that fork temp repos MUST set this variable in `beforeEach`/`afterEach` to
   avoid `cannot derive abbreviation length` errors.
4. Run `node lib/internal/tools/migrate-json-formatting.mjs --dry-run` at any time to verify
  the in-scope `.json` corpus is conformant; a `wouldRewrite=0` result confirms no drift.
5. Markdown-embedded JSON objects with more than one key SHALL use the pretty-printed
  fenced-block form shown above; compact single-line dual-anchor blobs are forbidden. The
   forbidden shape is captured verbatim in
   `tests/fixtures/json-formatting/forbidden-inline-citation-snippet.raw` and matched by the
   `COMPACT_DUAL_ANCHOR_INNER` detector in `tests/migrate-json-formatting.test.mjs`; both
   surfaces exist precisely so this report does not need to inline a live violation.

## Testing

All validation commands pass with exit code 0. The test suite reports 71 tests, 0 failures.
Migration dry-run and write-mode evidence confirms zero-rewrite idempotency across two
independent write passes.

```json
{
  "kind": "lines",
  "path": "work/172983_05-23-26/67055_0522_json-formatting/review.md",
  "range": [19, 29],
  "contentHash": "bd00fb1"
}
```

### Validation command results


| Command                                                                                         | Exit code | Key result                         |
| ----------------------------------------------------------------------------------------------- | --------- | ---------------------------------- |
| `node --test tests/*.test.mjs`                                                                  | 0         | `tests=71`, `pass=71`, `fail=0`    |
| `node lib/internal/tools/migrate-json-formatting.mjs --dry-run`                                 | 0         | `candidates=144`, `wouldRewrite=0` |
| `PANCREATOR_MIGRATION_GO=1 node lib/internal/tools/migrate-json-formatting.mjs --write` (pass 1) | 0         | `files rewritten=0`                |
| `node lib/internal/tools/migrate-json-formatting.mjs --dry-run` (post-write)                    | 0         | `wouldRewrite=0`                   |
| `PANCREATOR_MIGRATION_GO=1 node lib/internal/tools/migrate-json-formatting.mjs --write` (pass 2) | 0         | `files rewritten=0`                |
| `node lib/internal/tools/check-phase-0a-scaffold.mjs`                                           | 0         | no drift reported                  |
| `node lib/internal/tools/context-budget-report.mjs`                                             | 0         | report emitted                     |
| `bash -n .cursor/hooks/enforce-policy-compliance.sh`                                            | 0         | shell syntax valid                 |


### Acceptance criteria coverage


| Spec clause                                                      | Test / evidence source                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `indent=2`, one KV per line (`.json`)                            | `canonical-formatter-shape` test; migration dry-run zero violations                       |
| Hash abbreviation length from `git rev-parse --short HEAD`       | `abbreviation-length-derivation` tests; `abbrevLen=7` in dry-run summary                  |
| Terminal/CLI output uses canonical shape                         | `stringifyCliJson` wired in `feature-delivery-run.ts` and `run.ts`; fixture parity checks |
| Agent-chat JSON uses canonical shape                             | `non-json-surface-detection` fixture tests; compact dual-anchor violation detector        |
| Markdown-embedded JSON uses canonical shape                      | forbidden compact inline citation fixture checks                                          |
| Glossary `contentHash` entry updated to specify abbreviated form | `glossary.md` updated; referenced in compliance YAML artifact list                        |
| Compliance descriptor validates against `latest.yaml`            | `descriptor-schema-conformance` review check                                              |
| Bulk migration is idempotent                                     | two-pass write loop; both `files rewritten=0`                                             |
| No pre-commit hook / Cursor rule changes                         | `out-of-scope-guard` check; `git diff --name-only -- .cursor/hooks .cursor/rules` empty   |
| Citation-verifier unchanged                                      | `out-of-scope-guard` check; citation-verifier paths unchanged                             |


```json
{
  "kind": "lines",
  "path": "work/172983_05-23-26/67055_0522_json-formatting/review.md",
  "range": [7, 17],
  "contentHash": "bd00fb1"
}
```

### Advisory findings (from review)

- Unrelated modified files appear in the local working tree outside this task; governed staging
SHOULD remain limited to the intended feature file set.
- Test output includes transient `fatal: not a git repository` lines from temp/sandbox test
contexts; all assertions pass regardless.

