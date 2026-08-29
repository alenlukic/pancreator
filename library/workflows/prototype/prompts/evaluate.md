## Objective

Tell the operator what this spike actually proved, and what it would cost to
turn into real work.

This is not a code review. Do not review the spike for production quality,
maintainability, or test coverage — it was built without them on purpose. Judge
only whether the evidence answers the questions.

## Steps

1. Read the prototype brief, the technical approach, and the spike output.
2. Verify the signals independently against the resulting workspace. Confirm the
   evidence shows what the spike claims it shows. A claim you cannot confirm is
   unanswered, not answered.
3. For each technical question, record the result: answered, partially
   answered, or unanswered, with the evidence you relied on. Name a cause of
   `product`, `environment`, `mixed`, or `none`, and whether a declared discard
   condition was met.
4. Record structured environment blockers for every credential, service, or
   tooling gap that prevented a decision.
5. Assess the signals themselves: is each one actually measuring the question,
   or is it measuring the stub? A signal produced entirely by hard-coded values
   answers nothing, and saying so is the most valuable thing you can report.
6. Reach a verdict:
   - `validated` — the approach works, the questions are answered affirmatively.
   - `invalidated` — the approach does not work, or a discard condition was met.
   - `inconclusive` — the spike did not produce enough signal to decide.
   - `environment_blocked` — environment gaps prevent a decision and no
     independent product discard condition applies.
     Do not report an inconclusive result as validated to avoid a negative answer.
7. When product discard evidence and environment gaps both exist, use
   `invalidated` if an independent product discard condition was met.
8. When the brief explicitly tests environment readiness, treat the observed
   readiness result as product evidence for that question and set
   `readiness_question: true` on its result. Without that field, a `product`
   cause on a question an environment blocker names is rejected.
9. Describe the productionization gap: what the declared shortcuts would cost to
   undo, what the spike never touched, and what a systematic run would need to
   cover. Be concrete enough that the operator could scope a `delivery` run from it.
10. List the discard candidates: spike code that should be deleted rather than
    carried forward, whatever the verdict.
11. Recommend productionizing, iterating the spike, or discarding it, with the
    reason.

## Output

Populate `data.evaluation` (`verdict`, `question_results`,
`environment_blockers`, `signal_assessment`, `productionization_gap`,
`recommendation`, `discard_candidates`). Each question result MUST include
`question_id`, `result`, `cause`, `evidence`, and `discard_condition_met`, and
MAY include `readiness_question` (boolean) to claim the explicit-readiness
exemption `PROTO-001` defines. Answer every `technical_questions` id the brief declares and no
other. Each environment blocker MUST list the question ids it prevented a
decision on in `affected_questions`. Valid verdicts are `validated`, `invalidated`, `inconclusive`, and
`environment_blocked`. Use `environment-blocked` only in operator prose. When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create either brief file.

## Done when

Every technical question has a grounded result with a named cause, environment
gaps are structured, the verdict follows from the evidence, the
productionization gap is scopeable, and the recommendation is unambiguous.
