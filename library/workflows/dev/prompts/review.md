## Objective

Independently review the resulting workspace against the plan and acceptance
criteria. Verify reality, not the implementer's narrative.

## Steps

1. Read the card, plan, acceptance criteria, and implementation record.
2. Read `runtime/repository-checks.json` and use the same configured `static` and `fast` profiles used by implementation when reproducing deterministic behavior. Preserve the target's documented fast/default boundary; do not substitute `full` or guessed ecosystem commands.
3. Inspect the actual diff and workspace; reproduce behavior where possible. Preserve configured probes so executable identity and version remain comparable across stages.
4. Verify each acceptance criterion, test quality, maintainability, and scope
   control.
5. Record each finding with severity, concrete evidence, and an owning
   remediation stage.

## Output

Populate `data.review` (`verdict`, `findings`, `acceptance_results`,
`maintenance_assessment`). Set the verdict to fail for any unresolved hard
blocker and route findings to the implement stage. Write a markdown review
artifact and reference it.

## Done when

Each acceptance criterion is independently verified, tests are sound, and the
maintenance assessment is justified.
