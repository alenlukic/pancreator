## Objective

Consolidate the parallel evidence reports into one independent, read-only
verification with a single graded verdict. The supervisor already ran every
evidence worker top-level and in parallel — always a reviewer on the code
dimension, a QA tester on the execution dimension when an acceptance criterion
has proof `live` or the criteria carry no proof type, and a design reviewer
plus a design QA tester when the run composes design — so each ran on its
mapped model. The card's required inputs name every report that ran, and that
list is authoritative over any count stated here. You own the joint verdict;
never edit source to fix what you find.

## Steps

On a scoped return visit the card carries a `Scoped return visit` section and
lists no evidence report. Then no evidence worker ran: read no report, execute
the cases the blast radius reaches yourself for each dimension the section
assigns, and record each dimension under `data.verify.dimensions` as the
Output section states. For the review dimension, confirm each prior finding
of the routing verdict as fixed or still open. A new finding in code the
remediation did not change blocks only at `blocker` severity; record a lower
one as a warning. Every other step applies unchanged.

When the card carries an `Evidence workers not launched` section, the harness
kept that worker off this visit and states why. QA runs only for a `live`
criterion. Without QA, read no QA report and owe no `qa_cases`: grade each
`test` criterion from the card's gate evidence, and each `review` criterion
from the review report and your spot checks. Record `observe` as the result of
each `observe` criterion. It defers the criterion to a signal after ship and
does not block the verdict.

1. Read the card, the ratified plan, the implementation record, and every
   parallel evidence report listed under the card's inputs. The plan is the
   `plan` stage output when the card lists one under its required inputs,
   otherwise the request the card delivers. A request that is the plan is the
   child specification with its acceptance criteria and validation plan, and
   the parent specification through its audited context reference when the
   read trigger applies. On a release run the implementation record is the
   integration record and the chunk verify outputs the card lists. On a
   release run, the acceptance criteria and validation cases are the child
   specifications the card lists. A missing or empty evidence report is a
   blocked stage, not a judgment call: report `blocked` and name the missing
   path. A report that carries cases but no `<!-- evidence-report: complete -->`
   line is the partial record of an interrupted worker: consolidate the cases
   it does hold, and state in your output which dimensions it left uncovered.
2. Reconcile the reports. Where two of them disagree about the same behavior,
   reproduce the disputed observation yourself before grading it.
3. Spot-check, do not redo. Verify the reports' critical claims: rerun one
   or two pivotal QA cases, read the diff hunks behind the highest-severity
   review findings, and confirm each acceptance criterion is actually covered
   by evidence rather than assertion. Fill any dimension the reports left
   uncovered with your own bounded checks.
4. Read `runtime/repository-checks.json` and preserve the target's documented
   profile boundaries when reproducing deterministic behavior. Do not run the
   `fast` or `full` profile yourself: reproduce with the impacted selection
   or the narrowest test in the blast radius. No verify gate runs the `full`
   profile; the ship release gate runs it once when the run enters ship, and
   a failing verdict forwards to remediate without running any suite. Any browser
   inspection during reproduction follows `BROWSER-001` and the guidance it
   references on the active invocation. Classify an intermittent timeout of a
   configured full-suite target check as product/test or environment rather
   than harness/test, unless harness-owned evidence implicates the harness.
5. Join everything into one findings list. Each finding carries `source`
   naming the evidence worker that produced it — `review` or `qa`, and
   `design-review` or `design-qa` on a design-composed run — a severity, a
   statement, and reproducible evidence citing the evidence report or your
   own reproduction.
6. Grade the joint verdict:
   - `pass`: every acceptance criterion verified or recorded `observe`,
     every QA case that ran passes, no findings.
   - `pass_with_warnings`: every QA case that ran passes, every acceptance
     criterion verified or recorded `observe`, and every finding is severity
     `high`, `medium`, or `low`. The
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

## Gate-cache acceptance

This statement is `GATE_CACHE_ACCEPTANCE_RULE` in `src/lib/gate-cache.ts`, the
one source the operator guide, the remediate prompt, and every worker card
that meets the mark also carry:

A gate marked `cached` is a real pass, not a skipped one: the identical gate
command passed cleanly at this same Git workspace fingerprint and
repository-check configuration within the last 24 hours, against a resolved
run baseline, and its evidence log carries that original captured output.
Treat it as evidence of the same strength as a pass the harness executed just
now, and do not order a rerun to replace it. A failure, timeout, skip,
override, or baseline-relative credit is never accepted this way.

## Output

Populate `data.verify` (`verdict`, `findings`, `qa_cases`,
`acceptance_results`; `remediation_guidance` on any failing verdict;
`severity_rationale` on `fail_severe`). When QA ran, carry the QA report's
executed cases into `qa_cases` — each states `id`, `steps`, `expected`,
`actual`, and `result` — and cite the evidence report path for cases you did
not rerun. When QA did not run, `qa_cases` is not owed.
On a return visit after a remediation, a case carried from the earlier
verification instead of executed again also states `carried_from` with the
prior `invocation_id` and its `workspace_fingerprint`. That bound applies to
case coverage only; it changes no profile allowance.
Each acceptance result states the criterion `id`, a `result`, and evidence.
The result of an `observe` criterion is `observe`; the validator refuses
`observe` for a criterion whose declared proof is another type.
On a scoped return visit, also write `data.verify.dimensions.<role>` for each
dimension the card assigns, with a non-empty `summary` and a non-empty
`evidence[]`, and set each finding's `source` to the dimension that raised it.
Set the output `result` to `success` for `pass` and `pass_with_warnings`, and
to `failure` for `fail_remedial` and `fail_severe`. Do not launch subagents;
the parallel evidence workers already ran. Follow the card's `output.operator_brief` contract.

## Done when

Every evidence report the card lists is read in full and reconciled, each
finding names the worker it came from, their pivotal claims
are spot-checked, every acceptance criterion has an independently confirmed
result, findings are joined into one graded verdict, and a failing verdict
carries remediation guidance an agent can act on without you.
