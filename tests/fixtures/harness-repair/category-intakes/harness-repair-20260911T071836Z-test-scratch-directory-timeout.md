# Harness repair intake

**State:** Ready for self-development intake.
**Outcome:** Confirmed one test defect that times out the unit lane.
**Blockers:** None.
**Next action:** Run /pan-start with this file.
**Category:** Test issues (`test`)

## Original report

The operator reported that the unit lane intermittently exceeds its bound on a
machine with a slow temporary filesystem.

## Investigation scope

The fixture scratch allocator and the unit lane tests that clone a tree.

## Evidence examined

- The failing lane output and its recorded durations.
- The scratch directories the run left behind.
- The shared fixture template and its clone cost.

## Agent transcript coverage

The QA transcript was examined. No coder transcript applies, because the defect
predates the change under test. Delegation records were read as
prompt-delivery evidence and are not agent transcripts.

## Execution timeline

1. Several unit tests each built a full fixture template.
2. The lane exceeded its bound once the filesystem slowed.

## Findings

### HR-001 Each test rebuilt the shared fixture template

- **Classification:** harness bug
- **Severity:** medium
- **Evidence:** The profile artifact records one template build per test rather
  than one per file.
- **Expected contract:** Tests in one file share a template and clone it.
- **Causal chain:** The template helper ran inside each test body.
- **Root cause:** The shared template was allocated per test instead of once
  per file.
- **Affected surfaces:** the fixture helper and the unit tests that use it.

## Root-cause remediation

HR-001: allocate the shared fixture template once per file and clone it for
each test, so the lane pays the build cost once.

## Acceptance criteria

1. AC-001 HR-001 A file of several tests builds its fixture template once and
   clones it for each test.
2. AC-002 HR-001 The unit lane completes inside its bound on a filesystem that
   is deliberately slowed.

## Validation plan

Run the unit lane with the duration profile active and compare the recorded
template build count against the file count.

## Installation and migration impact

No installation impact. The test suite is self-development only and ships in no
installation payload.

## Constraints and out of scope

Do not lower a coverage threshold, and do not move a test to a slower lane to
avoid the bound.

## Open questions and unknowns

None.

## Recommended next action

Run /pan-start with this intake in the Pancreator self-development repository.
