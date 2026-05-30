f---
title: US-1 Dogfood Phase 4 Exit
feature_id: us-1-dogfood-phase-4-exit
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-16T00:00:00Z
references:
  - kind: path
    path: docs/M1.index.md
    note: Phase 4 dogfood exit gaps remain open before Phase 5 M1 backlog work begins.
  - kind: path
    path: docs/BOOTSTRAP.md
    note: Phase 4 requires a real US-1 dogfood run, external run-log verification, pause/resume/abort exercise, and proof artifacts before exit.
  - kind: path
    path: AGENTS.md
    note: `src/inbox/in/` is the canonical incoming queue and phase boundaries require human ratification.
---

# US-1 Dogfood Phase 4 Exit

## Problem

Bootstrap remains blocked in Phase 4. Phase 5 M1 backlog work SHALL NOT start
until the repository closes the remaining US-1 dogfood items with empirical
proof rather than inferred readiness.

Current Phase 4 gaps are:

- no real US-1 dogfood run has been completed end-to-end from `src/inbox/in/`
  through the persona stages and stage-boundary checkpoints;
- external run-log observability has not been verified;
- `pan pause`, `pan resume`, and `pan abort` have not been exercised
  empirically;
- the proof bundle for Phase 4 exit is incomplete; and
- human ratification of the Phase 4 exit has not been obtained.

## Goal

Close the Phase 4 bootstrap gate by running the real US-1 dogfood flow
end-to-end and producing the proof artifacts required before Phase 5 M1 backlog
work can begin.

## Non-goals

This task SHALL NOT start Phase 5 backlog delivery before the Phase 4 exit
evidence is complete.

This task SHALL NOT redefine the Phase 4 exit criteria.

This task SHALL NOT treat simulated or partial runs as sufficient proof.

## Required execution

### 1. Run the canonical US-1 dogfood flow

Place a real intake item in `src/inbox/in/` and run the `feature-delivery`
pipeline from intake through librarian. The run SHALL pass through the expected
persona stages and SHALL preserve stage-boundary checkpoint artifacts so the
path from inbox item to completion remains auditable.

The run SHALL cover these stage outcomes:

- `intake-analyst` canonicalizes the directive into the feature spec;
- `tech-lead` produces the plan, ADR draft, touch set, and handoff artifacts;
- `coder` implements the approved scope;
- `reviewer` records review and validation results;
- `tech-writer` produces the delivery report;
- `supervisor` stages the PR outcome without auto-push; and
- `librarian` closes and indexes the artifacts after acceptance.

### 2. Verify external run-log observability

Capture a run log from the real dogfood flow and verify that it renders cleanly
in an external observability tool such as Phoenix or Langfuse. Record enough
evidence to show the external trace is readable, complete, and attributable to
the dogfood run.

### 3. Exercise pause, resume, and abort empirically

Run a controlled second dogfood exercise that uses `pan pause`, `pan resume`,
and `pan abort` in a realistic stage context. The exercise SHALL demonstrate
that the commands work against live state and SHALL leave an auditable trail
showing when each intervention occurred and what state changed.

### 4. Produce the Phase 4 proof bundle

The final proof bundle SHALL include:

- a staged PR outcome for the dogfood slice;
- a delivery report staged under `src/inbox/out/`;
- a clean external run trace for the end-to-end dogfood run;
- evidence from the pause/resume/abort exercise; and
- a clear statement that the Phase 4 exit checklist is satisfied or a precise
  residual-gap list if not.

### 5. Obtain human ratification

After the proof bundle is assembled, present the artifacts for human review and
obtain explicit ratification of the Phase 4 exit before any Phase 5 M1 backlog
work begins.

## Acceptance criteria

1. A real inbox item under `src/inbox/in/` has been processed end-to-end
   through the Phase 4 US-1 dogfood flow.
2. Every expected persona stage has produced its stage artifact or checkpoint
   evidence.
3. The end-to-end run log has been verified in an external observability tool.
4. A second controlled run has exercised `pan pause`, `pan resume`, and
   `pan abort` successfully.
5. The repository has a staged PR outcome for the dogfood slice.
6. A delivery report for the dogfood run exists under `src/inbox/out/`.
7. The proof bundle contains a clean external run trace plus intervention
   evidence.
8. Any residual blockers are recorded explicitly; otherwise the Phase 4 exit is
   declared ready.
9. Human ratification of the Phase 4 exit has been requested with the complete
   proof bundle attached.
10. Phase 5 M1 backlog work remains blocked until criterion 9 is satisfied.

## Manual validation requested from operator

After the proof bundle is staged, the operator SHALL:

1. inspect the staged PR outcome for the dogfood slice;
2. inspect the delivery report under `src/inbox/out/`;
3. inspect the external run trace and confirm it is clean and attributable to
   the dogfood run;
4. inspect the intervention evidence for `pan pause`, `pan resume`, and
   `pan abort`; and
5. ratify the Phase 4 exit or record the remaining blocker list.
