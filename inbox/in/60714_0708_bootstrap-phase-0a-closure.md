---
title: Bootstrap Phase 0a Closure - monorepo scaffold
feature_id: bootstrap-phase-0a-closure
stage: intake
owner: intake-analyst
status: open
created_at: 2026-04-27T01:49:00-04:00
references:
  - kind: lines
    path: BOOTSTRAP.md
    range: [36, 57]
    contentHash: TBD-on-commit
    note: Phase 0a defines the monorepo scaffold, top-level directories, and always-on rule shim requirements.
  - kind: lines
    path: BOOTSTRAP.md
    range: [95, 98]
    contentHash: TBD-on-commit
    note: Phase 0 exit criterion requires the scaffold, handbook seed, meta-personas, and green round-trip gate.
  - kind: lines
    path: BOOTSTRAP.md
    range: [205, 212]
    contentHash: TBD-on-commit
    note: Phase 3 CI conformance gates depend on the workspace/tooling scaffold landing first.
---

Open a Phase 0a closure directive for the missing monorepo scaffold and package
tooling. The work should reconcile the bootstrap plan with the current repo
state, then route the missing scaffold into the canonical intake to planning
pipeline.

Scope includes the workspace root, package skeletons, build/config tooling,
and the phase-0 exit checklist needed before Phase 3 can proceed cleanly.
