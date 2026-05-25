# Phase 4 Proof Bundle Index

This index anchors empirical Phase 4 exit evidence under
`src/memory/features/us-1-dogfood-phase-4-exit/`. After `tess close-artifacts`
relocates a nested run from `src/work/<day>/<task-id>/` into
`src/internal/work_archive/<day>/<task-id>/`, the **librarian** (or other closing
persona named on `next-prompt.md`) SHALL refresh the work-directory and
`run.log.jsonl` cells in this file so canonical paths stay auditable. Operators
SHALL NOT hand-maintain path bookkeeping for closed nested runs.

## Nested end-to-end dogfood run (proof-bundle index slice)

| Field | Value |
| --- | --- |
| Directive | `src/inbox/in/phase-4-dogfood-proof-bundle-index.md` |
| Nested task id | `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` |
| Work directory | `src/internal/work_archive/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/` |
| Run log | `src/internal/work_archive/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/run.log.jsonl` |

## External observability (Phoenix)

| Field | Value |
| --- | --- |
| Evidence doc | `src/memory/features/us-1-dogfood-phase-4-exit/phoenix-trace-evidence.md` |
| Screenshot or export | Deferred — see evidence doc (`@tesseract/run-logger` Phoenix importer not shipped in this bootstrap slice). |

## Intervention probe (pause, resume, abort)

| Field | Value |
| --- | --- |
| Directive | `src/inbox/in/phase-4-intervention-probe.md` |
| Nested task id | `71096_0415_phase-4-intervention-probe-pause-resume-abort` |
| Work directory | `src/internal/work_archive/172988_05-18-26/71096_0415_phase-4-intervention-probe-pause-resume-abort/` |
| Run log | `src/internal/work_archive/172988_05-18-26/71096_0415_phase-4-intervention-probe-pause-resume-abort/run.log.jsonl` |
| Structured evidence (final) | `src/memory/features/us-1-dogfood-phase-4-exit/pause-resume-abort-evidence.json` |

## Ship and reporting artifacts

| Field | Value |
| --- | --- |
| Staged PR outcome | Supervisor-local dogfood slice (no remote push); tie-break to nested task `77373_0230_phase-4-dogfood-proof-bundle-evidence-index` ledger under `src/internal/work_archive/172988_05-18-26/77373_0230_phase-4-dogfood-proof-bundle-evidence-index/`. |
| Delivery report (per-feature) | `src/memory/features/us-1-dogfood-phase-4-exit/delivery-report.md` |
| Delivery report (outbox copy) | `src/inbox/out/` copy when parent US-1 run completes ship/index per `phase-4-ratification-request.md`. |

## Residual gaps

The Phase 4 exit checklist is now ratified with one remaining engineering deferral:

1. Satisfied: human ratification is recorded in `phase-4-ratification-request.md`.
2. Open engineering backlog: external trace verification (Phoenix or Langfuse) is **not yet implemented** under `phoenix-trace-evidence.md` because the `@tesseract/run-logger` OTLP → observability-backend path is deferred in this bootstrap slice; remediation stays with **tesseract-engineer**.
3. Satisfied: the supervisor-local staged PR outcome and matching `src/inbox/out/172987_05-19-26/77614_0226_us-1-dogfood-phase-4-exit-delivery-report.md` delivery copy exist for the US-1 dogfood slice.

Intervention pause / resume / abort evidence is **captured** in
`pause-resume-abort-evidence.json` with archive-local snapshot paths.

Remediation owner for path realignment after `tess close-artifacts`: **librarian**
per nested run `next-prompt.md`. Remediation owner for Phoenix wiring: **tesseract-engineer**
per PRD run-logger scope.
