---
title: Resolve 17 stub @tesseract/* feature folders
feature_id: resolve-package-stub-feature-folders
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:06Z
references:
  - kind: path
    path: src/memory/features/tesseract-cli/spec.md
    note: 17-line Phase-2 placeholder; identical pattern across 16 sibling tesseract-* feature folders.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 2 mandates spec/plan/tasks/contracts per package; the current shells satisfy none of those.
  - kind: path
    path: src/memory/handbook/contract-format.md
    note: Layer-1 normative style is non-optional; stub specs cannot satisfy it.
  - kind: path
    path: src/memory/features/json-formatting/
    note: Reference shape for what a fully realized M1 feature folder looks like (spec, delivery report, index.json).
---

# Resolve 17 stub @tesseract/* feature folders

## Problem

`src/memory/features/` carries 17 feature folders of the form `tesseract-<pkg>/`
where each `spec.md` is a 17-line shell that says "this feature folder
captures Phase 2 delivery requirements" and points at a non-existent
contract index. None of these folders has a `plan.md`, a `tasks.md`, a
delivery report, or a contracts directory. They look like Phase 2 cargo
cult; they fail Layer-1 lint by inspection; and they pollute the feature
listing that `librarian` and `tess feature` operate against.

## Goal

Decide, per package, whether each `tesseract-<pkg>/` feature folder is
authored to Phase-2 completeness or removed in favor of a single
Phase-2-summary feature folder, and then act on the decision.

## Required outcomes

1. A single tech-lead-authored disposition table classifies each of the
   17 folders into one of three buckets:
   - `author`: package surface still warrants per-package spec; complete
     spec/plan/tasks/contracts to Phase 2 standard.
   - `consolidate`: the package contract is small enough to fold into a
     `phase-2-substrate-contracts/` umbrella feature folder.
   - `delete`: the package is post-M1 (e.g., contract-runner-rego stays as
     a thin shim through M2) and the folder offers no signal; remove with a
     deletion ADR.
2. For `author` items, the folder is brought up to the
   `src/memory/features/json-formatting/` shape (delivery report, index.json,
   contract clauses).
3. For `consolidate` items, the new umbrella folder cites every consolidated
   package and inherits the Phase-2 sequencing dependency order.
4. For `delete` items, the deletion ADR cites Phase-2 BOOTSTRAP language and
   the package README that owns the residual contract.
5. `src/memory/features/index.json` is updated in lockstep.

## Acceptance criteria

- Zero feature folders with a 17-line stub `spec.md` remain after this
  feature ships.
- Layer-1 lint (when wired) passes against the resulting feature folders.
- The disposition table is referenced from `src/memory/active/current.md`
  for the duration of the cleanup so future audits can cite the decision.
- A compliance-auditor broad sweep against `src/memory/features/` reports
  zero `block` findings tied to placeholder shells.

## Out of scope

- Authoring new contracts beyond the Phase-2 surface enumerated in BOOTSTRAP.
- Renaming any package whose contract surface is otherwise stable.

## Recommended downstream owners

- `tech-lead` for the disposition table and the consolidation ADR.
- `contract-writer` for any folder kept under `author`.
- `librarian` for the index update and active-memory rotation.
