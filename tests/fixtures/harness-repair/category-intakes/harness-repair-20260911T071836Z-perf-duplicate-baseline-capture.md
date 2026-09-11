# Harness repair intake

**State:** Ready for self-development intake.
**Outcome:** Confirmed one performance defect in baseline capture.
**Blockers:** None.
**Next action:** Run /pan-start with this file.
**Category:** Performance (`perf`)

## Original report

The operator reported that a cohort session spent several minutes capturing the
same repository-check baseline in each chunk worktree.

## Investigation scope

Cohort baseline capture and the repository-check profile runner.

## Evidence examined

- The cohort record and its recorded baseline pointers.
- The run state and events of each chunk run in the session.
- The recorded duration of each baseline capture.

## Agent transcript coverage

The supervisor transcript was examined. No worker transcript applies, because
the harness captures a baseline before it delegates. The delegation records were
read as prompt-delivery evidence and are not agent transcripts.

## Execution timeline

1. The first chunk run captured a static and a fast baseline.
2. Each later chunk run captured its own pair instead of adopting the recorded
   pointer.

## Findings

### HR-001 Each chunk run recaptured the shared baseline

- **Classification:** harness bug
- **Severity:** medium
- **Evidence:** Four baseline capture records carry four distinct fingerprints
  for one cohort session.
- **Expected contract:** A cohort session holds one baseline for each interior
  gate profile.
- **Causal chain:** The adoption lookup ran before the cohort record existed, so
  it found no pointer and fell through to capture.
- **Root cause:** Baseline adoption reads the cohort record at run creation
  rather than at the first prepare of a source-allowed stage.
- **Affected surfaces:** cohort baseline resolution and its integration tests.

## Root-cause remediation

HR-001: move the baseline adoption lookup to the first prepare of a
source-allowed stage, so the pointer the first chunk run recorded is visible to
every later chunk run of the session.

## Acceptance criteria

1. AC-001 HR-001 A cohort session of three or more chunk runs records exactly
   one static baseline and one fast baseline.
2. AC-002 HR-001 A chunk run that starts after the shared baseline exists
   adopts the recorded pointer instead of capturing its own.

## Validation plan

Run the cohort unit and integration lanes, then a synthetic cohort session of
three chunks and assert one recorded baseline per interior gate profile.

## Installation and migration impact

No state migration is required. A cohort session already in flight keeps the
baselines it captured.

## Constraints and out of scope

Do not change what a baseline measures, and do not change the interior gate
profile set.

## Open questions and unknowns

None.

## Recommended next action

Run /pan-start with this intake in the Pancreator self-development repository.
