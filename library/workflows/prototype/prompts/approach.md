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
3. Describe the strategy — the shortest path to making the signals observable.
   Prefer the cheapest mechanism that still produces a trustworthy signal.
4. Name the touch points: the areas, modules, or files the spike will reach
   into. An approximate list is expected; exact file paths are not required.
5. Name the shortcuts you are choosing on purpose, and what each one buys.
   Anything the brief already listed as an acceptable shortcut belongs here if
   you intend to use it.
6. Restate the observable signals concretely: what will be run or looked at,
   and what result answers which question.
7. State the discard conditions: the results that would invalidate the
   hypothesis. A prototype that cannot fail is not testing anything.

## Output

Populate `data.technical_approach` (`hypothesis`, `strategy`, `touch_points`,
`planned_shortcuts`, `observable_signals`, `discard_conditions`). Author the
approach as the invocation's schema-valid brief JSON, render it to the exact
HTML path from the output contract, and reference the HTML first and the brief
JSON second.

## Done when

Every technical question maps to a signal this approach produces, the shortcuts
are named rather than designed around, and the conditions that would invalidate
the hypothesis are explicit.
