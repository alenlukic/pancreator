# Plan — bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants

## Architecture summary

This plan executes the batch as a non-destructive normalization pass: Work package A classifies all 20 `src/memory/features/tesseract-*/` folders as `author` and completes each folder to the reference shape (`spec.md`, `delivery-report.md`, `index.json`) while preserving existing `plan.md`, `tasks.md`, and `contracts/` assets; Work package B removes per-persona `-standard` and `-complex` Cursor projection files and moves tier-selection guidance into canonical metadata/docs so operators can choose tier without filename suffix coupling.

## Task plan

1. Build and record the 20-folder disposition table for Work package A, with one bucket per folder and one rationale per row.
2. For each `author` row, add missing `delivery-report.md` and `index.json`, then align local feature metadata to the Phase-2 reference shape used by `json-formatting`.
3. Update `src/memory/features/index.json` in lockstep so global indexing reflects per-folder authoring outcomes.
4. Delete all 24 `.cursor/agents/*-standard.md` and `.cursor/agents/*-complex.md` files in one change set while preserving 12 persona alias files and `general-purpose.md`.
5. Update projection/tier policy docs to remove filename-suffix coupling and define tier selection by invocation metadata/policy (`AGENTS.md`, `subagent-model-tiers`, and impacted handbook guidance).
6. Update source/test surfaces that currently assert the legacy three-file tier layout so CI validates the single-file-per-persona model.
7. Run the declared validation commands and record any pre-existing failures in the implement report.

## Work package A disposition table

| Folder | Bucket | Rationale |
|---|---|---|
| `src/memory/features/tesseract-adopter-scan/` | `author` | Folder already carries `spec.md`, `plan.md`, `tasks.md`, and `contracts/`; complete missing index/report surfaces only. |
| `src/memory/features/tesseract-checkpointer-fs/` | `author` | Same normalization path; preserve existing contract corpus and add missing index/report. |
| `src/memory/features/tesseract-cli/` | `author` | Existing Phase-2 package contract scope should remain; add reference-shape artifacts. |
| `src/memory/features/tesseract-contract/` | `author` | Existing contract coverage should remain; align folder metadata/report shape. |
| `src/memory/features/tesseract-contract-runner-llm-judge/` | `author` | Keep package-local contracts; complete index/report surfaces. |
| `src/memory/features/tesseract-contract-runner-rego/` | `author` | Keep package-local contracts; complete index/report surfaces. |
| `src/memory/features/tesseract-contract-style/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-core/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-env-isolation/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-inbox/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-intervention/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-mcp-server/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-memory/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-notifier/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-persona/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-pipeline/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-policy/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-run-logger/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-runner-cursor/` | `author` | Existing authored folder; normalize to reference shape without deletion. |
| `src/memory/features/tesseract-worktree/` | `author` | Existing authored folder; normalize to reference shape without deletion. |

## Work package B implementation notes

- Keep one canonical projection per persona at `.cursor/agents/<persona>.md`.
- Keep `.cursor/agents/general-purpose.md` as standalone fallback.
- Keep `.cursor/rules/<persona>.mdc` shims unchanged unless drift is detected during implementation.
- Remove all suffix-based tier references in operator-facing docs that imply file-name routing.
- Preserve standard-by-default and complex-on-escalation policy, but express it as invocation policy rather than file-path selection.

## Validation plan

- `node --test tests/*.test.mjs`
- `node src/internal/tools/check-phase-0a-scaffold.mjs`
- `node src/internal/tools/context-budget-report.mjs`
- `bash -n .cursor/hooks/enforce-policy-compliance.sh`

## Traceability to Engineering Spec

- Work package A disposition requirement and 20-folder baseline are implemented by the disposition table and Task 1–3.
- Work package A reference-shape requirement is implemented by Task 2 and Task 3.
- Work package B single-file projection, suffix deletion, and documentation updates are implemented by Task 4–6.
- Cross-cutting batch reporting and stale-reference cleanup are implemented by Task 5–7 and downstream report/review stages.

## Documentation impact decision

```yaml
documentation_impact:
  applies: true
  rationale: "The plan changes canonical operator guidance for agent invocation tiers and feature-folder indexing/reporting surfaces."
  changed-surfaces:
    - AGENTS.md
    - src/memory/handbook/subagent-model-tiers.md
    - src/memory/handbook/persona-spec.md
    - src/memory/handbook/context-economy.md
    - src/memory/handbook/operator-output-contract.md
    - src/memory/features/index.json
  deferred-items: []
```

## Citations

- `{kind: lines, path: src/memory/features/bootstrap-cruft-cleanup-batch-stub-feature-folders-and-cursor-agent-variants/spec.md, range: [65, 135], contentHash: 0158529}` — acceptance criteria for disposition, tier policy, and suffix removal.
- `{kind: lines, path: src/inbox/in/172981_05-25-26/71700_0612_bootstrap-cruft-cleanup-batch.md, range: [34, 137], contentHash: ec6a02d}` — batch directive intent and required outcomes.
- `{kind: lines, path: src/memory/features/json-formatting/spec.md, range: [1, 179], contentHash: 697b305}` — reference shape target for authored feature folders.
- `{kind: lines, path: src/memory/handbook/subagent-model-tiers.md, range: [1, 93], contentHash: 6d90e18}` — tier selection authority independent of filename suffixes.
- `{kind: lines, path: AGENTS.md, range: [76, 110], contentHash: e037427}` — planning/execution boundary and delegated stage contract.
