---
title: Ratification request — intake spec for m1-substrate-runtime-batch
feature_id: m1-substrate-runtime-batch
stage: intake-ratification
owner: operator
status: open
created_at: 2026-05-26T23:23:49Z
references:
  - kind: lines
    path: src/memory/features/m1-substrate-runtime-batch/spec.md
    range: [1, 50]
    contentHash: b8cf506
    note: Canonical Engineering Spec staged for human_approval gate — frontmatter and # Spec paragraph.
  - kind: lines
    path: src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md
    range: [1, 40]
    contentHash: b8cf506
    note: Source batch directive that this spec canonicalizes.
---

# Ratification request — intake spec for `m1-substrate-runtime-batch`

The `intake-analyst` has completed the `canonicalize-spec` procedure for the
batch directive at
`src/inbox/in/172980_05-26-26/2597_2316_m1-substrate-runtime-batch.md`.

The canonical Engineering Spec is staged at:

```
src/memory/features/m1-substrate-runtime-batch/spec.md
```

## Intake summary

- **Clarifying rounds completed:** 0 (directive was sufficiently specified)
- **Open questions closed:** 0 (zero ambiguities requiring human reply)
- **Open questions deferred to future Features:** 0

## Key decisions recorded in spec

1. **Delivery phasing** — Three-phase delivery order is encoded:
   - Phase 1: WP-A (checkpointer) + WP-B (runner) — harness prerequisites
   - Phase 2: WP-C (pipeline compiler) — requires WP-A and WP-B green; acceptance includes e2e stub run via SDK runner
   - Phase 3: WP-D (run-logger conformance), WP-E (library-mode example), WP-F (install paths) — no inter-package dependencies

2. **WP-D option choice** — **Option A** (Phoenix/Langfuse Docker smoke tests under `tests/run-logger-conformance/`) is ratified as the intake default. Option B (formal deferral ADR at `src/memory/adr/0007-run-logger-phoenix-conformance-deferral.md`, milestone M2) is the fallback if Option A fails in implementation; it requires explicit tech-lead ratification via inbox item before activation.

## Action required

Human operator SHALL review `src/memory/features/m1-substrate-runtime-batch/spec.md`
and either:

- **Accept:** stage the spec and run `pnpm -w exec tess advance` to move the `intake` stage to `plan`, then invoke `tech-lead` for the plan stage.
- **Reject with edits:** reply to this inbox item with required changes; the `intake-analyst` SHALL fold the reply into the spec and re-stage.
