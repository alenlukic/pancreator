# Harness repair intake

**State:** Ready for self-development intake.
**Outcome:** Confirmed two internal consistency defects across gate authority.
**Blockers:** None.
**Next action:** Run /pan-start with this file.
**Category:** Internal consistency (`int-con`)

## Original report

The operator reported that one stage card told the worker to run a profile the
verification level had already skipped.

## Investigation scope

Verification-level remapping, stage gate resolution, and the card renderer.

## Evidence examined

- The workflow snapshot and the verification snapshot of the run.
- The rendered invocation card and its resolved gate list.
- The recorded gate results of the affected stage.

## Agent transcript coverage

The verifier transcript was examined and shows the worker running the skipped
profile. The remediator transcript is unavailable, because that stage never
ran. Delegation records were read as prompt-delivery evidence rather than as
transcripts.

## Execution timeline

1. The run resolved a verification level that skips the full profile at verify.
2. The rendered card still listed the full profile as a worker obligation.
3. The worker ran the profile and reported a duration the gate never wanted.

## Findings

### HR-001 The card listed a gate the verification level had skipped

- **Classification:** governance miss
- **Severity:** medium
- **Evidence:** The card gate list names the full profile while the
  verification snapshot marks it skipped.
- **Expected contract:** A card lists the gates the resolved level keeps.
- **Causal chain:** The renderer read the workflow stage definition instead of
  the resolved level.
- **Root cause:** Gate resolution and card rendering read two different
  sources of gate truth.
- **Affected surfaces:** card rendering, verification resolution, and their
  unit tests.

### HR-002 The worker guidance contradicted the agent profile rule

- **Classification:** compliance issue
- **Severity:** low
- **Evidence:** The card told the worker to run a profile that policy reserves
  for the harness.
- **Expected contract:** An agent never runs the full profile.
- **Causal chain:** The stale gate list reached the worker instruction block.
- **Root cause:** The instruction block derives from the same stale gate list.
- **Affected surfaces:** card rendering and the worker instruction template.

## Root-cause remediation

HR-001: make card rendering read the resolved verification level, so the card
and the gate runner share one source of gate truth.

HR-002: derive the worker instruction block from the same resolved list, so a
skipped gate never reaches a worker as an obligation.

## Acceptance criteria

1. AC-001 HR-001 A card rendered under a level that skips a gate omits that
   gate from its gate list.
2. AC-002 HR-002 A card rendered under the same level gives the worker no
   instruction to run the skipped profile.
3. AC-003 HR-001 The gate runner and the card renderer resolve their gate list
   through one shared function.

## Validation plan

Run the verification and render unit lanes, then render one card for each
built-in verification level and compare its gate list against the resolved
level.

## Installation and migration impact

No state migration is required. A run already in flight keeps its recorded
verification snapshot.

## Constraints and out of scope

Do not change the built-in verification levels or their remappings. Remediate
`harness-repair-20260911T071836Z-perf-duplicate-baseline-capture.md` first when
both land in one release, because that change moves the baseline lookup this
work reads.

## Open questions and unknowns

None.

## Recommended next action

Run /pan-start with this intake in the Pancreator self-development repository.
