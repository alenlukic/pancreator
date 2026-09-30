## Objective

Consolidate the parallel evidence reports into one independent, read-only
verification of the consolidated best-of-N implementation, and issue one
graded verdict. The supervisor already ran every evidence worker top-level and
in parallel — always a reviewer on the code dimension, and a QA tester on the
execution dimension when an acceptance criterion has proof `live`, the change
touches a user-facing surface, or the criteria carry no proof type — so each
ran on its mapped model. The card's required inputs name every report that
ran. You own the joint verdict. Never edit source to fix what you find.

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
   criteria, and every parallel evidence report listed under the card's
   inputs. A missing or empty evidence report is a blocked stage, not a
   judgment call: report `blocked` and name the missing path.
2. Reconcile the reports. Where they disagree about the same behavior,
   reproduce the disputed observation yourself before grading it.
3. Spot-check, do not redo. Verify the reports' critical claims: rerun one
   or two pivotal QA cases, read the diff hunks behind the highest-severity
   review findings, and confirm each acceptance criterion is actually covered
   by evidence rather than assertion. Fill any dimension the reports left
   uncovered with your own bounded checks.
4. Read `runtime/repository-checks.json` and preserve the target's documented
   profile boundaries when reproducing deterministic behavior.
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
   ship or that impugn the verification itself: weakened, deleted, or gamed
   tests; acceptance criteria not actually covered; security or data-loss
   defects. A QA pass never demotes these.
8. On any failing verdict this workflow returns to consolidation, so write
   `remediation_guidance` the metacritic can act on directly: the failing
   observation, the reproduction command or steps, and the expected behavior.

## Output

Populate `data.verify` (`verdict`, `findings`, `qa_cases`,
`acceptance_results`; `remediation_guidance` on any failing verdict;
`severity_rationale` on `fail_severe`). When QA ran, carry the QA report's
executed cases into `qa_cases` — each states `id`, `steps`, `expected`,
`actual`, and `result` — and cite the evidence report path for cases you did
not rerun. When QA did not run, `qa_cases` is not owed.
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

Every evidence report the card lists is read in full and reconciled, their pivotal claims
are spot-checked, every acceptance criterion has an independently confirmed
result, findings are joined into one graded verdict, and a failing verdict
carries remediation guidance the consolidation stage can act on without you.
