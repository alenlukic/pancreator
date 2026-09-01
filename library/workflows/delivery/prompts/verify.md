## Objective

Consolidate the parallel review and QA evidence reports into one independent,
read-only verification with a single graded verdict. The supervisor already
ran both evidence workers top-level and in parallel — a reviewer on the code
dimension and a QA tester on the execution dimension — so each ran on its
mapped model. You own the joint verdict; never edit source to fix what you
find.

## Steps

1. Read the card, the ratified plan (specification, acceptance criteria, test
   plan), the implementation record, and both parallel evidence reports listed
   under the card's inputs. A missing or empty evidence report is a blocked
   stage, not a judgment call: report `blocked` and name the missing path.
2. Reconcile the two reports. Where they disagree about the same behavior,
   reproduce the disputed observation yourself before grading it.
3. Spot-check, do not redo. Verify the reports' critical claims: rerun one
   or two pivotal QA cases, read the diff hunks behind the highest-severity
   review findings, and confirm each acceptance criterion is actually covered
   by evidence rather than assertion. Fill any dimension the reports left
   uncovered with your own bounded checks.
4. Read `runtime/repository-checks.json` and preserve the target's documented
   profile boundaries when reproducing deterministic behavior. Do not run the
   `fast` or `full` profile yourself: reproduce with the narrowest test in the
   blast radius. On a passing verdict the verify submission gate runs the
   `full` profile once; on a failing verdict the run forwards to remediate
   and the suite does not run. After a remediation returns, the gate accepts
   the remediate gate's recorded `full` pass at an unchanged fingerprint. Any browser
   inspection during reproduction follows `BROWSER-001` and the guidance it
   references on the active invocation. Classify an intermittent timeout of a
   configured full-suite target check as product/test or environment rather
   than harness/test, unless harness-owned evidence implicates the harness.
5. Join everything into one findings list. Each finding carries `source`
   (`review` or `qa`), a severity, a statement, and reproducible evidence
   citing the evidence report or your own reproduction.
6. Grade the joint verdict:
   - `pass`: every acceptance criterion verified, all QA cases pass, no
     findings.
   - `pass_with_warnings`: all QA cases pass, every acceptance criterion
     verified, and every finding is severity `high`, `medium`, or `low`. The
     change demonstrably works, so these findings become warnings; the harness
     routes them to the operator inbox for follow-up. Do not spend attempts
     arguing them.
   - `fail_remedial`: a blocker finding, failed acceptance criterion, or
     failed QA case exists, and the defect is locally repairable against the
     ratified plan.
   - `fail_severe`: the failure is fundamental — the approach, the plan, or an
     acceptance criterion is wrong, or the implementation cannot satisfy the
     plan as ratified. Justify this grade in `severity_rationale`.
7. Severity `blocker` is reserved for findings that make the change unsafe to
   ship or that impugn the verification itself: weakened, deleted, or gamed
   tests; acceptance criteria not actually covered; security or data-loss
   defects. A QA pass never demotes these.
8. For a failing verdict, write `remediation_guidance` the remediation agent
   can act on directly: the failing observation, the reproduction command or
   steps, and the expected behavior. Feedback quality decides repair success;
   write it as if you will not be available for questions.

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
carries remediation guidance an agent can act on without you.
