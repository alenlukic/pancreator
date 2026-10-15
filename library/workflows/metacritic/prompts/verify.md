## Objective

Consolidate the parallel evidence reports into one independent verification of
the consolidated best-of-N implementation, and issue one graded verdict. Product
source stays read-only. The supervisor already ran every evidence worker top-level
and in parallel — always a reviewer on the code dimension, and a QA tester on the
execution dimension when an acceptance criterion has proof `live`, the change
touches a user-facing surface, or the criteria carry no proof type — so each ran
on its mapped model. The card's required inputs name every report that ran.
You own evidence correctness and the joint verdict. Never edit product source.

## Evidence ownership

Consume the incoming evidence packet reference on the card. Extend the same
cumulative packet at `data.verify.evidence_packet` with reconciliation, claim spot
checks, criterion coverage, and the final fast result. Retain earlier results,
failures, waivers, repairs, and raw provenance. Do not replace the packet on a
return visit or invocation rename.

The verifier and harness MUST normalize or repair runtime formatting, shape,
path, citation, timestamp, and identity defects when actual signal is unchanged.
Preserve the raw record and record each repair, original reference, and corrected
representation in that packet. A structural defect alone MUST NOT block acceptance
or route work to product remediation. Missing real proof, actual failures,
unresolved contradictions, altered assertions, and security or data-loss concerns
remain blockers. Do not invent proof or hide a failure.

## Steps

When the card carries an `Evidence workers not launched` section, the harness
kept that worker off this visit and states why. Without QA, read no QA report
and owe no `qa_cases`. Grade each `test` criterion from the test that the
consolidation's `acceptance_results` evidence or `tests_added` names for it,
plus the card's gate evidence that the test ran and passed. A `test` criterion
with no named test fails. Grade each `review` criterion from the review report
and your spot checks. Record `observe` as the result of each `observe`
criterion. It defers the criterion to a signal after ship and does not block
the verdict.

1. Read the card, the consolidation record with its claims and acceptance
   criteria, and every parallel evidence report listed under the card's inputs.
   Resolve repairable paths, aliases, and shapes before declaring a report absent.
   A genuinely missing or empty required report is a blocked stage: report
   `blocked` and name the missing proof.
2. Reconcile the reports. Where they disagree about the same behavior,
   reproduce the disputed observation yourself before grading it.
3. Spot-check, do not redo. Verify the reports' critical claims: rerun one
   or two pivotal QA cases, read the diff hunks behind the highest-severity
   review findings, and confirm each acceptance criterion is actually covered
   by evidence rather than assertion. Fill any dimension the reports left
   uncovered with your own bounded checks.
4. Read `runtime/repository-checks.json` and preserve the target's documented
   profile boundaries. Use the impacted selection or the narrowest affected test
   for spot checks. After evidence correctness and the other required verify
   checks pass, own the final `fast` profile check. The harness may run it on your
   behalf and append its actual result to the same packet. The final gate is
   `fast`. Ship and release commands run no tests or validation checks. A failing
   verdict returns to consolidation without a suite run.
5. Join everything into one findings list. Each finding carries `source`
   (`review` or `qa`), a severity, a statement, and reproducible evidence
   citing the evidence report or your own reproduction.
6. Grade the joint verdict:
   - `pass`: every acceptance criterion verified or recorded `observe`,
     every QA case that ran passes, no findings.
   - `pass_with_warnings`: every QA case that ran passes, every acceptance
     criterion verified or recorded `observe`, and every finding is severity
     `high`, `medium`, or `low`. The
     change demonstrably works, so these findings become warnings; the harness
     routes them to the operator inbox for follow-up.
   - `fail_remedial`: a blocker finding, failed acceptance criterion, or
     failed QA case exists, and the defect is locally repairable within the
     consolidated implementation.
   - `fail_severe`: the failure is fundamental — the consolidation chose the
     wrong approach or cannot satisfy the acceptance criteria. Justify this
     grade in `severity_rationale`.
7. Severity `blocker` is reserved for findings that make the change unsafe to
   ship or that impugn the verification itself: missing real proof, actual
   failures, unresolved contradictions, altered, weakened, deleted, or gamed
   assertions, acceptance criteria not actually covered, and security or
   data-loss concerns. A QA pass never demotes these.
8. On any failing verdict this workflow returns to consolidation, so write
   `remediation_guidance` the metacritic can act on directly: the failing
   observation, the reproduction command or steps, and the expected behavior.

## Output

Populate `data.verify` (`verdict`, `findings`, `qa_cases`, `acceptance_results`,
`evidence_packet`; `remediation_guidance` on any failing verdict;
`severity_rationale` on `fail_severe`). `evidence_packet` extends the incoming
cumulative packet and preserves raw provenance and repair records. Apply the
resolved verify validators to corrected runtime evidence without changing actual
signal. When QA ran, carry the QA report's executed cases into `qa_cases` — each
states `id`, `steps`, `expected`, `actual`, and `result` — and cite the evidence
report path for cases you did not rerun. When QA did not run, `qa_cases` is not owed.
Each acceptance result states the criterion `id`, a `result`, and evidence.
The result of an `observe` criterion is `observe`. The validator refuses
`observe` for a criterion whose declared proof is another type, and any other
result for an `observe` criterion.
Set the output `result` to `success` for `pass` and `pass_with_warnings`, and
to `failure` for `fail_remedial` and `fail_severe`. Do not launch subagents;
the parallel evidence workers already ran. When `output.operator_brief`
exists, edit its declared source and reference the rendered HTML. Do not run
the renderer. When the contract omits `output.operator_brief`, do not create
either brief file.

## Done when

Every required report is read in full and reconciled, pivotal claims are
spot-checked, and every acceptance criterion has an independently confirmed
result. The same cumulative packet retains provenance and repairs and carries
the final fast result for a passing verdict. Findings form one graded verdict,
and a failing verdict carries actionable guidance for consolidation.
