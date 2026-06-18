# Feature-delivery pipeline and run operations

Use when changing feature-delivery stages, SDK progress, inbox kickoff, QA/review gates, or run lifecycle semantics.

Read this category index before opening individual feature records. Prefer the compact rows below unless a task needs one specific feature record.

| Feature | Status | Planning context | Retained contracts | Path |
|---|---|---|---|---|
| `batch-feature-delivery-runs-sequential-parallel` | indexed | This feature ships pnpm -w exec pan batch run as a batch orchestrator over existing startFeatureDelivery SDK sub-runs on isolated worktree branches. @pancreator/worktree… | no | `lib/memory/features/delivery-pipeline/batch-feature-delivery-runs-sequential-parallel/index.json` |
| `build-mode-inbox-scaffolding` | indexed | This feature closes the gap between Cursor Build mode and the Pancreator inbox queue. The implement stage verified pre-existing shared intake scaffold code in… | no | `lib/memory/features/delivery-pipeline/build-mode-inbox-scaffolding/index.json` |
| `cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref` | indexed | This batch delivered the three operator-facing affordances called for in the feature spec: | no | `lib/memory/features/delivery-pipeline/cli-operator-tooling-batch-deferral-protocol-intake-scaffolder-active-memory-ref/index.json` |
| `fd-pipeline-sdk-mode-retry-model-escalation-tiers` | indexed | This delivery adds declarative SDK model escalation tiers for feature-delivery retries. Operators configure pancreator-model-escalation.yaml at the repository root… | no | `lib/memory/features/delivery-pipeline/fd-pipeline-sdk-mode-retry-model-escalation-tiers/index.json` |
| `feature-delivery-harness-wire-cursorrunner-through-run-and-advance` | indexed | This delivery wires feature-delivery to an opt-in Cursor SDK path shared by run and advance, while manual mode remains the default operator flow. It also resolves real… | no | `lib/memory/features/delivery-pipeline/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/index.json` |
| `inbox-convention-migration` | indexed | This re-entry slice hardens the standalone inbox convention migration tool and extends legacy thread discovery so nested layout is handled safely. Review records… | no | `lib/memory/features/delivery-pipeline/inbox-convention-migration/index.json` |
| `phase-4-dogfood-proof-bundle-evidence-index` | pending-human-ratification | This slice ships the Phase 4 dogfood proof-bundle evidence index as a documentation-only contract. It defines a real seven-stage nested feature-delivery run, preserves… | no | `lib/memory/features/delivery-pipeline/phase-4-dogfood-proof-bundle-evidence-index/index.json` |
| `phase-4-intervention-probe-pause-resume-abort` | pending-human-ratification | This feature ships a bounded Phase 4 intervention probe that captures empirical pause, resume, and abort evidence while the run sits at live plan, then records matching… | no | `lib/memory/features/delivery-pipeline/phase-4-intervention-probe-pause-resume-abort/index.json` |
| `surface-opt-track-o-cli-engine` | indexed | Compressed memory record for surface-opt Track O — CLI/runner engine pass. | no | `lib/memory/features/delivery-pipeline/surface-opt-track-o-cli-engine/index.json` |
| `us-1-dogfood-phase-4-exit` | human-ratified | This phase-4 exit slice ships the scaffold for the dogfood proof bundle, not the empirical proof itself. It adds the nested proof-bundle-index directive, the… | no | `lib/memory/features/delivery-pipeline/us-1-dogfood-phase-4-exit/index.json` |
