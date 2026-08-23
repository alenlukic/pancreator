## Objective

Independently review the resulting workspace against the plan and acceptance
criteria. Verify reality, not the implementer's narrative, and repair bounded
non-structural issues without forcing an unnecessary implementation loop.

## Steps

1. Read the card, plan, acceptance criteria, and implementation record. Apply the
   review method the card's review-method section declares; a card without that
   section reviews the change as one reviewer.
2. Read `runtime/repository-checks.json` and use the same configured `static` and `fast` profiles used by implementation when reproducing deterministic behavior. Preserve the target's documented fast/default boundary; do not substitute `full` or guessed ecosystem commands.
3. Inspect the actual diff and workspace; reproduce behavior where possible. Preserve configured probes so executable identity and version remain comparable across stages.
4. Verify each acceptance criterion, test quality, maintainability, and scope control.
5. When verification proves a criterion unimplementable, self-contradictory, unverifiable, or otherwise unworkable as written, amend it instead of failing the run against text you have proven wrong. Keep the criterion id, record the original and amended text with a reason class, justification, and reproduced evidence in `data.review.criterion_amendments`, and verify the workspace against the amended text. Amend the minimum needed to make the criterion workable; criterion removal and product-intent reversal stay with the operator. When the card's operator-involvement section shows the specification was ratified without the operator, the criteria are auto-ratified drafts: apply a lower amendment threshold and prefer amending over looping or pausing the run.
6. For each issue, first determine whether intended behavior is unambiguous and the fix is local, low-risk, and does not alter architecture, public interfaces, data or persistence models, security boundaries, dependencies, or the approved approach.
7. Repair and validate issues that satisfy that boundary. Record the finding, changed files, remediation, and evidence; do not repair silently.
8. Route major, structural, ambiguous, high-blast-radius, migration-requiring, or cross-component implementation issues to implementation. Treat harness governance, path-resolution, validator, renderer, and artifact-contract defects as non-blocking diagnostics for ship review; they never justify a review-to-implementation loop.

## Output

Populate `data.review` (`verdict`, `findings`, `acceptance_results`,
`maintenance_assessment`, and `criterion_amendments` when the review amends any
criterion). Each finding must state severity, evidence,
remediation ownership, and whether it was resolved during review. A finding you
resolved during review must set `resolution: resolved_in_review`,
`remediation_stage: review`, and a non-empty `changed_files` array listing
every file the repair edited — disclosing the edits in prose does not satisfy
the validator. Each criterion
amendment must state the criterion id, original statement, amended statement,
reason class, justification, and reproduced evidence, and the matching
acceptance result must be judged against the amended text. Set the
verdict to fail only for unresolved hard implementation blockers and route those findings to
the implement stage with `remediation_stage: implement`. An unresolved finding whose defect lies outside the run's workspace (a harness or governance defect the coder cannot fix in this run) takes `remediation_stage: operator`, which routes it to operator/ship review without failing the verdict or looping the workflow. Record governance/artifact diagnostics as advisories without failing the review verdict. When `output.operator_brief` exists, edit its declared source and reference the rendered HTML. Do not run the renderer. When the contract omits `output.operator_brief`, do not create either brief file.

## Done when

Each acceptance criterion is independently verified, any criterion amended in
review is justified with evidence and re-verified as amended, tests are sound,
bounded reviewer-owned defects are remediated and validated, unresolved
structural issues are routed to implementation, and the maintenance assessment
is justified.
