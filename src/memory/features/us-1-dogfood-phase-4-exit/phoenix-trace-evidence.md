# Phoenix Trace Evidence (Phase 4 Dogfood)

## Status (bootstrap)

External Phoenix (or Langfuse) import is **not** an operator-led bookkeeping step
in this repository slice. Run logs are preserved as JSONL under the nested task
work directory (and, after `tess close-artifacts`, under
`src/internal/work_archive/<day>/<task-id>/`). Filling a live trace screenshot or
export is **blocked on product implementation**: `@tesseract/run-logger` OTLP
exporters and a documented importer path per `docs/PRD.md` / README Phase 4 exit
notes. **tesseract-engineer** owns that wiring; until it lands, Phase 4 exit
remains open on trace verification even when pause/resume/abort and nested
pipelines are complete.

## Preconditions (when tooling exists)

1. Complete one nested `feature-delivery` run from
   `src/inbox/in/phase-4-dogfood-proof-bundle-index.md`.
2. Preserve the nested `run.log.jsonl` without edits (path below is canonical
   after librarian closure for task `77373_0230_phase-4-dogfood-proof-bundle-evidence-index`).

## Operator steps (when importer exists)

1. Import the preserved OTLP JSON lines into Phoenix using the workflow shipped
   with the run-logger / importer slice (not manual ad hoc steps).
2. Confirm the trace is readable end-to-end, span hierarchy covers invoke through
   stage transitions, and attributes identify the nested dogfood task identifier.
3. Export one screenshot **or** structured trace export file into this proof-bundle
   directory.
4. Record the artifact filename in the table below.

## Evidence record

| Field | Value |
| --- | --- |
| Nested dogfood task id | `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` |
| Run log path | `src/internal/work_archive/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl` |
| Phoenix session or export reference | _Deferred — no Phoenix importer in repo bootstrap; engineering-owned._ |
| Screenshot or export filename under proof bundle | _Deferred — same._ |
| Verification notes | _N/A until importer exists._ |

No placeholder telemetry qualifies as proof per feature non-goals.
