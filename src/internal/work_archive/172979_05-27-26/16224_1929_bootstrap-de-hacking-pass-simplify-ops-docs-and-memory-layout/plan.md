# Plan — bootstrap de-hacking pass

## Architecture Summary

This Feature SHALL keep the existing `feature-delivery` human-gated loop and reduce bootstrap load by moving operator procedure into `OPERATION.md`, consolidating debt into the backlog, preserving implemented Feature memory only when each folder has concrete implementation anchors, and replacing heavy default CI with local librarian pre-close validation. This plan satisfies the spec delivery phasing, WP-1 through WP-6 acceptance criteria, validation expectations, documentation-impact requirements, and human gates cited at `{kind: lines, path: src/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/spec.md, range: [147, 159], contentHash: 44c42d2}`, `{kind: lines, path: src/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/spec.md, range: [161, 388], contentHash: 44c42d2}`, and `{kind: lines, path: src/memory/features/bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout/spec.md, range: [448, 464], contentHash: 44c42d2}`.

## Phasing Choice

The implement stage SHALL ship one ordered change set with three internal commits-worth of work but no actual commit:

1. Phase 1: execute WP-1 and WP-4 first. Update feature-folder disposition, backlog debt encoding, and workspace maps before operator docs describe the new layout.
2. Phase 2: execute WP-2, WP-3, and WP-6 next. Extract `OPERATION.md`, slim `README.md`, audit operator output, add bare-`pan` detection, and remove duplicate doctrine.
3. Phase 3: execute WP-5 last. Slim CI only after `OPERATION.md`, the backlog schema, and librarian validation text exist.

## Feature Folder Disposition

Each `src/memory/features/<id>/` subdirectory receives exactly one disposition:

| Disposition | Feature folders |
|---|---|
| `keep-implemented` | `active-memory-context-economy-pass-2`, `bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants`, `bootstrap-de-hacking-pass-simplify-ops-docs-and-memory-layout`, `bootstrap-phase-0a-closure`, `ci-best-practices-batch`, `compliance-tests`, `cursor-token-economy`, `inbox-convention-migration`, `json-formatting`, `m1-substrate-runtime-batch-harness-loop-install-paths-library-mode-phoenix-confo`, `phase-4-dogfood-proof-bundle-evidence-index`, `phase-4-intervention-probe-pause-resume-abort`, `pancreator-adopter-scan`, `pancreator-checkpointer-fs`, `pancreator-cli`, `pancreator-contract`, `pancreator-contract-runner-llm-judge`, `pancreator-contract-runner-rego`, `pancreator-contract-style`, `pancreator-core`, `pancreator-env-isolation`, `pancreator-inbox`, `pancreator-intervention`, `pancreator-mcp-server`, `pancreator-memory`, `pancreator-notifier`, `pancreator-persona`, `pancreator-pipeline`, `pancreator-policy`, `pancreator-run-logger`, `pancreator-runner-cursor`, `pancreator-worktree`, `timestamp-naming-conventions`, `us-1-dogfood-phase-4-exit` |
| `relocate-to-backlog` | `m1-substrate-runtime-batch` |
| `archive-or-delete` | none |

The executor SHALL add or refresh `artifact_index.implementation_surface` on each `keep-implemented` index. For package-spec folders, the implementation anchor SHALL name the matching `src/internal/packages/@pancreator/<package>/` path, contract files, or delivery report. For `bootstrap-phase-0a-closure`, the executor SHALL add `delivery-report.md` from the existing verification artifact. For the active de-hacking Feature, the implementation anchor SHALL be completed by the later report and index stages.

## Ordered Work Packages

1. WP-1 SHALL relocate `m1-substrate-runtime-batch` into `src/memory/backlog/index.yaml` with draft preservation at `src/memory/backlog/drafts/m1-substrate-runtime-batch.md`, delete the original folder, update `src/memory/features/index.json`, and reconcile `src/memory/active/current.md`.
2. WP-4 SHALL choose `tags: [debt]` as the debt encoding because it composes with existing backlog status and priority fields without replacing item ownership. It SHALL update `backlog-format.md`, `memory-tiers.md`, `AGENTS.md`, `docs/PRD.md`, and `docs/PRD.index.md`; no `src/internal/packages/@pancreator/mcp-server/` change is planned because no current MCP source advertises `src/memory/debt/`.
3. WP-2 SHALL create `OPERATION.md` with the six required top-level sections, slim `README.md` to at most 120 lines, add `OPERATION.md` pointers in `AGENTS.md` and `docs/M1.index.md`, and update `src/memory/handbook/pancreator-config.md` to require OPERATION updates when operator-facing interfaces change.
4. WP-3 SHALL create `operator-output-audit.md`, fix every runnable bare-`pan` command found in the scoped audit, and add `src/internal/tools/check-operator-output.mjs` plus `tests/operator-output-contract.test.mjs`.
5. WP-6 SHALL create `duplication-inventory.md`, consolidate duplicate doctrine into canonical handbook or `OPERATION.md` pages, and add no ADR unless the inventory marks an intentional dual location.
6. WP-5 SHALL set `.github/workflows/phase-0a-scaffold.yml` to `narrow-paths` by removing generated work/archive paths from default triggers and SHALL set `.github/workflows/run-logger-conformance.yml` to `workflow-dispatch-only` with a backlog re-enable trigger. It SHALL update `src/personas/librarian.md` and `OPERATION.md` with the pre-close validation gate.

## Risks And Gates

- Feature-folder updates touch many durable-memory indexes. The executor SHALL preserve every existing citation and refresh hashes only when edited.
- `docs/PRD.md` carries future M3 debt references. The executor SHALL make surgical wording changes only and SHALL NOT rewrite product scope.
- Persona files are protected surfaces. The executor SHALL limit persona edits to operator-output command fixes and the librarian pre-close duty.
- Validation SHALL run `node --test tests/*.test.mjs`, `node src/internal/tools/check-phase-0a-scaffold.mjs`, `node src/internal/tools/context-budget-report.mjs`, `bash -n .cursor/hooks/enforce-policy-compliance.sh`, and the new operator-output check.

## Documentation Impact

```yaml
documentation_impact:
  applies: true
  rationale: "The Feature changes operator procedure, workspace maps, memory-tier policy, CI posture, persona duties, and validation guidance."
  changed-surfaces:
    - AGENTS.md
    - README.md
    - OPERATION.md
    - docs/M1.index.md
    - docs/PRD.index.md
    - docs/PRD.summary.md
    - docs/PRD.md
    - src/personas/librarian.md
    - src/memory/handbook/backlog-format.md
    - src/memory/handbook/memory-tiers.md
    - src/memory/handbook/operator-output-contract.md
    - src/memory/handbook/pancreator-config.md
    - src/memory/backlog/index.yaml
    - src/memory/features/index.json
    - src/memory/active/current.md
  deferred-items: []
```
