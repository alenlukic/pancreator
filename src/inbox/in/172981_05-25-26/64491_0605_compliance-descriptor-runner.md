---
title: Compliance descriptor runner — automate tests/compliance/*.yaml
feature_id: compliance-descriptor-runner
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:09Z
references:
  - kind: path
    path: tests/compliance/
    note: Five descriptors plus schemas/latest.yaml; per the manual runbook these are operator-on-demand only.
  - kind: path
    path: src/memory/features/compliance-tests/
    note: Feature folder records the manual-runbook decision and the deferred automation backlog item.
  - kind: path
    path: AGENTS.md
    note: §6.1 states descriptors run on operator-on-demand triggers and after structural changes; automation is backlog-tracked.
  - kind: path
    path: src/personas/compliance-auditor.md
    note: Compliance-auditor persona depends on a runnable descriptor surface; manual runs limit the gate's reach.
---

# Compliance descriptor runner — automate tests/compliance/*.yaml

## Problem

`tests/compliance/*.yaml` defines five descriptors against
`tests/compliance/schemas/latest.yaml`, and the compliance-auditor persona
is meant to evaluate them. Today they are operator-on-demand: there is no
runner, no CI gate, no exit-code contract, and no scheduling. The
`compliance-tests` feature folder explicitly defers automation. As a
consequence the descriptors are aspirational documents, not enforced
gates, and the broad-sweep audits fall back to ad-hoc shell sequences.

## Goal

Ship a thin compliance-descriptor runner that loads each YAML descriptor,
executes its assertion against the repository, and emits a structured
result so the descriptor surface is evaluated by tooling rather than by
operator memory.

## Required outcomes

1. `node src/internal/tools/run-compliance.mjs [<descriptor>]` runs one or
   all descriptors under `tests/compliance/*.yaml` against the repository
   and exits non-zero on any `severity: block` finding.
2. The runner validates each descriptor against
   `tests/compliance/schemas/latest.yaml` before running its assertion.
3. A pluggable assertion adapter handles the existing assertion shapes
   (path-presence, JSON-formatting check, timestamp-naming check, etc.)
   without coupling the runner to a single check kind.
4. CI runs the full descriptor surface on every PR after the regular test
   suite.
5. The runner emits a JSON result file under `src/work/<day>/<task-id>/`
   when a `--run-id` is passed, so compliance audits can cite the run
   evidence dual-anchor.

## Acceptance criteria

- `node src/internal/tools/run-compliance.mjs` runs all five descriptors
  green against the current `main`.
- Adding a new YAML descriptor under `tests/compliance/` makes it
  automatically picked up by the runner without code changes.
- A descriptor with an intentionally failing assertion produces a non-zero
  exit, a stable error format, and a stable JSON result file.
- The compliance-auditor persona's tool grant is reconciled to invoke the
  runner directly.

## Out of scope

- Authoring new descriptors beyond what already exists.
- A CLI surface (`tess compliance run`) — the node script is sufficient
  until M2 wires it through `tess`.
- LLM-judge descriptor execution (M2 scope per PRD §4.5).

## Recommended downstream owners

- `tesseract-engineer` for the runner implementation and CI wiring.
- `compliance-auditor` for the assertion-adapter contract.
- `reviewer` for the exit-code and JSON-result audit.
