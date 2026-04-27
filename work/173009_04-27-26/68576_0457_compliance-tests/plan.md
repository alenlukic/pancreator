---
title: Plan Stage Artifact - compliance-tests
feature_id: compliance-tests
stage: plan
status: ready-for-implement
owner: tech-lead
updated_at: 2026-04-27
approval_artifact: inbox/threads/compliance-tests/68576_0457_round-05-human-approve.md
next_owner: coder
next_stage: implement
references:
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [55, 60]
    contentHash: TBD-on-commit
    note: Scope states round-05 approval closes remediation and authorizes planning.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [62, 69]
    contentHash: TBD-on-commit
    note: Acceptance criteria define canonical storage paths and schema versioning.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [70, 81]
    contentHash: TBD-on-commit
    note: Acceptance criteria define invocation modes, manual-first execution, default cadence, and structure-change triggers.
  - kind: lines
    path: memory/features/compliance-tests/spec.md
    range: [82, 94]
    contentHash: TBD-on-commit
    note: Acceptance criteria define severity routing, run persistence, and AGENTS guidance.
  - kind: lines
    path: inbox/threads/compliance-tests/68576_0457_round-01.md
    range: [6, 29]
    contentHash: 31a70528685506d06e58660095b3024e87844a14cbeee56f55445bbcb976e77c
    note: Operator clarifications define canonical paths, manual-first execution, trigger classes, and severity defaults.
  - kind: lines
    path: inbox/threads/compliance-tests/68576_0457_round-04-human-reject.md
    range: [8, 17]
    contentHash: TBD-on-commit
    note: Rejection requires path correction, agent invocation policy, and AGENTS updates.
  - kind: lines
    path: inbox/threads/compliance-tests/68576_0457_round-05-human-approve.md
    range: [1, 3]
    contentHash: TBD-on-commit
    note: Human approval authorizes plan-stage handoff after remediation.
  - kind: lines
    path: PRD.md
    range: [655, 658]
    contentHash: 3f8e5fca0653a15f80e65081ce6e5c520894f0711dcf8e06f0395852c6fd30ff
    note: Plan stage exits with plan.md, adr-draft.md, and touch-set.json.
  - kind: lines
    path: PRD.md
    range: [801, 806]
    contentHash: 795854275bb49d19c6a3d4816a8ea69cf4c88302fd59cdc377ea843390185bba
    note: Touch-set declaration supports conflict planning and execution boundaries.
---

The implement slice SHALL keep compliance descriptors and schemas in the canonical `tests/compliance/` tree, SHALL remove rejected duplicate files under `memory/features/compliance-tests/contracts/`, SHALL preserve operator and agent manual invocation for slice one, SHALL keep scheduler automation deferred to backlog, and SHALL preserve AGENTS trigger guidance for structure-change compliance runs.

## Implementation Tasks

1. Verify `tests/compliance/schemas/latest.yaml` and `tests/compliance/schemas/v1.yaml`; each schema MUST validate descriptor fields `schema_ref`, `id`, `severity`, `trigger_modes`, `scope`, and `assertion`.
2. Verify the three canonical seed descriptors in `tests/compliance/`; each descriptor MUST use `schema_ref: "tests/compliance/schemas/latest.yaml"` and one accepted severity value.
3. Remove or leave unstaged the rejected duplicate descriptor and schema files under `memory/features/compliance-tests/contracts/`; implement output MUST NOT store compliance tests or schemas in that tree.
4. Verify `memory/features/compliance-tests/manual-runbook.md`; the runbook MUST name `scheduled-cadence`, `structure-change`, and `operator-on-demand` and MUST declare manual operator and agent invocation as the executable first-slice path.
5. Verify the runbook trigger matrix; it MUST cover persona, skill, pipeline, documented operational primitive, testing infrastructure, operator interface, and milestone-ratification changes.
6. Verify `memory/features/compliance-tests/severity-routing.md` and `memory/features/compliance-tests/run-template.json`; routing MUST encode high, medium, and low obligations, and run records MUST persist timestamp, trigger mode, test identifiers, and pass/fail outcomes.
7. Verify `AGENTS.md`; it MUST instruct agents to run compliance descriptors after qualifying structure changes and during automation-deferred manual invocations.
8. Verify `memory/backlog/index.yaml`; it MUST keep one deferred automation item for 4-hour scheduler enforcement and automatic structure-change execution.

## Spec Traceability

1. Tasks 1-3 satisfy canonical path and schema-versioning acceptance criteria.
2. Tasks 4 and 8 satisfy invocation-mode, manual-first, and 4-hour deferred-cadence acceptance criteria.
3. Task 5 satisfies structure-change trigger acceptance criteria.
4. Task 6 satisfies high, medium, low, and run-persistence acceptance criteria.
5. Task 7 satisfies AGENTS trigger-guidance acceptance criteria.

## Handoff Notes - Coder

- Owner: `coder`; stage: `implement`.
- Stay inside `work/173009_04-27-26/68576_0457_compliance-tests/touch-set.json`.
- Treat the `tests/compliance/` files as the canonical assets.
- Delete or exclude the `memory/features/compliance-tests/contracts/` duplicate files before handoff.
- Do not implement scheduler daemons in this slice.
- Run schema validation or a focused YAML parse check for every descriptor touched.

## Handoff Notes - Reviewer

- Verify canonical descriptors and schemas live only under `tests/compliance/`.
- Verify manual invocation remains agent-invokable and operator-invokable.
- Verify the trigger matrix covers every accepted structure-change class.
- Verify `AGENTS.md` guidance does not weaken pipeline delegation rules.
