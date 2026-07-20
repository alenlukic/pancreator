## Objective

Independently critique the design specification and mocks against the design
handbook heuristic checklist. Verify reality, not the designer’s narrative.

## Steps

1. Read the card, intake, design output, and unrolled DESIGN-001 / handbook guidance.
2. Inspect the design spec and every mock path; open HTML prototypes and exercise
   primary views where possible.
3. Score each handbook checklist heuristic; record results with evidence.
4. Verify each draft acceptance criterion for observability and coverage.
5. Severity-rank findings, cite the violated law or checklist item, and propose the
   minimal fix. Route unresolved hard findings back to the design stage.

## Output

Populate `data.review` with `verdict`, `findings`, `heuristic_results`, and
`acceptance_results`. Author the review brief as the invocation's schema-valid brief
JSON and reference the rendered HTML first and the brief JSON second.

## Done when

Heuristics are scored, acceptance criteria are assessed, and the verdict reflects
only unresolved hard blockers when failing.
