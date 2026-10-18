## Objective

Consolidate the parallel evidence reports into one independent verification
with a single graded verdict. Product source stays read-only. The supervisor
already ran every evidence worker top-level and in parallel — always a reviewer
on the code dimension, a QA tester on the execution dimension when an acceptance
criterion has proof `live`, the change touches a user-facing surface, or the
criteria carry no proof type, and a design reviewer plus a design QA tester when
the run composes design — so each ran on its mapped model. The card's required
inputs name every report that ran, and that list is authoritative over any count
stated here. You own evidence correctness and the joint verdict. Never edit
product source to fix what you find.

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

On a scoped return visit the card carries a `Scoped return visit` section and
lists no evidence report. Then no evidence worker ran: read no report, grade
the harness-collected cases the blast radius reaches for each dimension the section
assigns, and record each dimension under `data.verify.dimensions` as the
Output section states. For the review dimension, confirm each prior finding
of the routing verdict as fixed or still open. A new finding in code the
remediation did not change blocks only at `blocker` severity. Record a lower
one as a warning. Every other step applies unchanged.

When the card carries an `Evidence workers not launched` section, the harness
kept that worker off this visit and states why. QA runs only for a `live`
criterion or a change that touches a user-facing surface. Without QA, read no
QA report and owe no `qa_cases`. Grade each `test` criterion from the test that
the implementation's `acceptance_results` evidence or `tests_added` names for
it, plus the card's gate evidence that the test ran and passed. A `test`
criterion with no named test records `evidence_unavailable`; it fails only on a
cited defect. Grade each `review` criterion from the
review report and your spot checks. Record `observe` as the result of each
`observe` criterion. It defers the criterion to a signal after ship and does
not block the verdict.

1. Read the card, the ratified plan, the implementation record, and every
   parallel evidence report listed under the card's inputs. The plan is the
   `plan` stage output when the card lists one under its required inputs,
   otherwise the request the card delivers. A request that is the plan is the
   child specification with its acceptance criteria and validation plan, and
   the parent specification through its audited context reference when the
   read trigger applies. On a release run the implementation record is the
   integration record and the chunk verify outputs the card lists. On a
   release run, the acceptance criteria and validation cases are the child
   specifications the card lists. Resolve repairable paths, aliases, and shapes
   before declaring a report absent. Absence of evidence is not evidence of
   an issue: a criterion fails only on a cited defect, and evidence you cannot
   obtain is recorded as `evidence_unavailable` with its reason and owner in
   `risks`. An evidence gap never makes the verdict fail (`VERIFY-001`).
   Determine completeness from actual coverage, not a marker alone. Normalize a
   missing `<!-- evidence-report: complete -->` marker only when the existing
   evidence establishes completeness. Retain partial observations and state
   which dimensions genuinely lack proof.
2. Reconcile the reports. Where two of them disagree about the same behavior,
   grade the harness-collected reproduction before resolving the disagreement.
   Request a missing declared observation in
   `data.verification_execution_requests` as an array of `{id, reason}`.
   Requests MUST NOT carry executable definitions.
3. Spot-check, do not redo. Grade the raw observations for one
   or two pivotal QA cases, read the diff hunks behind the highest-severity
   review findings, and confirm each acceptance criterion is actually covered
   by evidence rather than assertion. Fill any dimension the reports left
   uncovered with independent file inspection or an authorized observation.
4. Read `runtime/repository-checks.json` and preserve the target's documented
   profile boundaries. You MUST NOT execute shell commands or profiles. The
   harness collects authorized bounded observations before delegation, runs
   profiles, and applies final output validators. Cite current gate evidence.
   The harness appends the actual final `fast` result to the same packet. Its gate is
   `fast`. Ship and release commands run no tests or validation checks. A failing
   verdict forwards to remediate without a suite run. Any browser inspection
   during reproduction follows `BROWSER-001` and the guidance on the invocation.
   Classify an intermittent timeout of a configured target check as product/test
   or environment rather than harness/test, unless harness evidence implicates
   the harness.
   Undefined operations use the existing blocked route: `result: blocked`,
   `data.verify.blocking_reason`, and non-empty `missing_evidence_paths`, without
   a product verdict. A source-authorized stage supplies missing authority.
   Missing or stale observations cannot support a pass. Terminal stdout alone
   cannot establish a genuine browser verdict.
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
   ship or that impugn the verification itself: missing real proof, actual
   failures, unresolved contradictions, altered, weakened, deleted, or gamed
   assertions, acceptance criteria not actually covered, and security or
   data-loss concerns. A QA pass never demotes these.
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

Populate `data.verify` (`verdict`, `findings`, `qa_cases`, `acceptance_results`,
`evidence_packet`; `remediation_guidance` on any failing verdict;
`severity_rationale` on `fail_severe`). `evidence_packet` extends the incoming
cumulative packet and preserves raw provenance and repair records. Apply the
resolved verify contract to corrected runtime evidence without changing actual
signal; the harness runs its validators. When QA ran, carry the QA report's executed cases into `qa_cases` — each
states `id`, `steps`, `expected`, `actual`, and `result` — and cite the evidence
report path for cases you did not rerun. When QA did not run, `qa_cases` is not owed.
On a return visit after a remediation, a case carried from the earlier
verification instead of executed again also states `carried_from` with the
prior `invocation_id` and its `workspace_fingerprint`. That bound applies to
case coverage only; it changes no profile allowance.
Each acceptance result states the criterion `id`, a `result`, and evidence.
The result of an `observe` criterion is `observe`. The validator refuses
`observe` for a criterion whose declared proof is another type, and any other
result for an `observe` criterion.
On a scoped return visit, also write `data.verify.dimensions.<role>` for each
dimension the card assigns, with a non-empty `summary` and a non-empty
`evidence[]`, and set each finding's `source` to the dimension that raised it.
Set the output `result` to `success` for `pass` and `pass_with_warnings`, and
to `failure` for `fail_remedial` and `fail_severe`. Do not launch subagents;
the parallel evidence workers already ran. Follow the card's `output.operator_brief` contract.

## Done when

Every required report is read in full and reconciled, each finding names its
worker, pivotal claims are spot-checked, and every acceptance criterion has an
independently confirmed result. The same cumulative packet retains provenance
and repairs and carries the final fast result for a passing verdict. Findings
form one graded verdict, and a failing verdict carries actionable guidance.
