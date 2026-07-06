## Objective

Independently review the resulting workspace against the plan and acceptance
criteria. Verify reality, not the implementer's narrative, and repair bounded
non-structural issues without forcing an unnecessary implementation loop.

## Steps

1. Read the card, plan, acceptance criteria, and implementation record.
2. Read `runtime/repository-checks.json` and use the same configured `static` and `fast` profiles used by implementation when reproducing deterministic behavior. Preserve the target's documented fast/default boundary; do not substitute `full` or guessed ecosystem commands.
3. Inspect the actual diff and workspace; reproduce behavior where possible. Preserve configured probes so executable identity and version remain comparable across stages.
4. Verify each acceptance criterion, test quality, maintainability, and scope control.
5. For each issue, first determine whether intended behavior is unambiguous and the fix is local, low-risk, and does not alter architecture, public interfaces, data or persistence models, security boundaries, dependencies, requirements, or the approved approach.
6. Repair and validate issues that satisfy that boundary. Record the finding, changed files, remediation, and evidence; do not repair silently.
7. Route major, structural, ambiguous, high-blast-radius, migration-requiring, or cross-component implementation issues to implementation. Treat harness governance, path-resolution, validator, renderer, and artifact-contract defects as non-blocking diagnostics for ship review; they never justify a review-to-implementation loop.

## Output

Populate `data.review` (`verdict`, `findings`, `acceptance_results`,
`maintenance_assessment`). Each finding must state severity, evidence,
remediation ownership, and whether it was resolved during review. Set the
verdict to fail only for unresolved hard implementation blockers and route those findings to
the implement stage. Record governance/artifact diagnostics as advisories without failing the review verdict. Author the review as the invocation's schema-valid brief
JSON, render it to the exact HTML path from the output contract, and reference
the HTML first and the brief JSON second.

## Done when

Each acceptance criterion is independently verified, tests are sound, bounded
reviewer-owned defects are remediated and validated, unresolved structural
issues are routed to implementation, and the maintenance assessment is
justified.
