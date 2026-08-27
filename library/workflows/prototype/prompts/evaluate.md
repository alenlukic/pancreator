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
   answered, or unanswered, with the evidence you relied on.
4. Assess the signals themselves: is each one actually measuring the question,
   or is it measuring the stub? A signal produced entirely by hard-coded values
   answers nothing, and saying so is the most valuable thing you can report.
5. Reach a verdict:
   - `validated` — the approach works, the questions are answered affirmatively.
   - `invalidated` — the approach does not work, or a discard condition was met.
   - `inconclusive` — the spike did not produce enough signal to decide.
     Do not report an inconclusive result as validated to avoid a negative answer.
6. Describe the productionization gap: what the declared shortcuts would cost to
   undo, what the spike never touched, and what a systematic run would need to
   cover. Be concrete enough that the operator could scope a `delivery` run from it.
7. List the discard candidates: spike code that should be deleted rather than
   carried forward, whatever the verdict.
8. Recommend productionizing, iterating the spike, or discarding it, with the
   reason.

## Output

Populate `data.evaluation` (`verdict`, `question_results`, `signal_assessment`,
`productionization_gap`, `recommendation`, `discard_candidates`). When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create either brief file.

## Done when

Every technical question has a grounded result, the verdict follows from the
evidence, the productionization gap is scopeable, and the recommendation is
unambiguous.
