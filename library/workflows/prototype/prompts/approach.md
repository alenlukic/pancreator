## Objective

Decide how the spike will produce the signals the brief asks for, and stop
there. This stage is deliberately thin: it exists so the approach being tested
is on the record, not to remove architectural decisions from implementation.

Do not produce a full engineering plan. A component inventory, interface
catalogue, or migration sequence for work the spike will not exercise is out of
scope for this stage.

## Steps

1. Read the ratified prototype brief.
2. State the hypothesis in one sentence: the technical claim the spike tests.
3. Identify external preconditions the spike depends on before it can change
   source. Distinguish product hypotheses from environment readiness such as
   credentials, services, or tooling.
4. Verify each precondition with a bounded check. Record its id, affected
   questions, check method, status, evidence, and whether it is volatile.
5. When a required precondition is unavailable or unknown, report `blocked`
   before build unless an explicit operator directive excludes every affected
   question. Cite the operator decision path for each excluded question.
6. Describe the strategy — the shortest path to making the signals observable.
   Prefer the cheapest mechanism that still produces a trustworthy signal.
7. Name the touch points: the areas, modules, or files the spike will reach
   into. An approximate list is expected; exact file paths are not required.
8. Name the shortcuts you are choosing on purpose, and what each one buys.
   Anything the brief already listed as an acceptable shortcut belongs here if
   you intend to use it.
9. Restate the observable signals concretely: what will be run or looked at,
   and what result answers which question.
10. State the discard conditions: the results that would invalidate the
    hypothesis. A prototype that cannot fail is not testing anything.

## Output

Populate `data.technical_approach` (`hypothesis`, `strategy`, `touch_points`,
`planned_shortcuts`, `observable_signals`, `discard_conditions`,
`preconditions`). Per `PROTO-001`, each precondition entry MUST include `id`,
`affected_questions`, `check`, `status`, `evidence`, and `volatile`. Use status
values `ready`, `unavailable`, or `unknown`. When an operator directive
narrows scope, record `exclusions` with `excluded_questions` and
`operator_decision_path`. When `output.operator_brief` exists, edit its
declared source and reference the rendered HTML. Do not run the renderer. When
the contract omits `output.operator_brief`, do not create either brief file.

## Done when

Every technical question maps to a signal this approach produces, external
preconditions are verified or the run pauses, the shortcuts are named rather
than designed around, and the conditions that would invalidate the hypothesis
are explicit.
