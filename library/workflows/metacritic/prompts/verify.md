## Objective

Consolidate the parallel review and QA evidence reports into one independent,
read-only verification of the consolidated best-of-N implementation, and issue
one graded verdict. The supervisor already ran both evidence workers top-level
and in parallel — a reviewer on the code dimension and a QA tester on the
execution dimension — so each ran on its mapped model. You own the joint
verdict; never edit source to fix what you find.

## Steps

1. Read the card, the consolidation record with its claims and acceptance
   criteria, and both parallel evidence reports listed under the card's
   inputs. A missing or empty evidence report is a blocked stage, not a
   judgment call: report `blocked` and name the missing path.
2. Reconcile the two reports. Where they disagree about the same behavior,
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
   - `pass`: every acceptance criterion verified, all QA cases pass, no
     findings.
   - `pass_with_warnings`: all QA cases pass, every acceptance criterion
     verified, and every finding is severity `high`, `medium`, or `low`. The
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
`severity_rationale` on `fail_severe`). Carry the QA report's executed cases
into `qa_cases` — each states `id`, `steps`, `expected`, `actual`, and
`result` — and cite the evidence report path for cases you did not rerun.
Each acceptance result states the criterion `id`, a `result`, and evidence.
Set the output `result` to `success` for `pass` and `pass_with_warnings`, and
to `failure` for `fail_remedial` and `fail_severe`. Do not launch subagents;
the parallel evidence workers already ran. When `output.operator_brief`
exists, edit its declared source and reference the rendered HTML. Do not run
the renderer. When the contract omits `output.operator_brief`, do not create
either brief file.

## Done when

Both evidence reports are read in full and reconciled, their pivotal claims
are spot-checked, every acceptance criterion has an independently confirmed
result, findings are joined into one graded verdict, and a failing verdict
carries remediation guidance the consolidation stage can act on without you.
