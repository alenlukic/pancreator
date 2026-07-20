# Design critique

Use when reviewing a design spec and mocks against handbook heuristics.

## Principle

Critique is independent, checklist-driven, and minimal-fix oriented. Score
reality, not intent.

## Steps

1. Read the design handbook checklist unrolled into the invocation.
2. Open the spec and each mock; exercise primary views.
3. Score every checklist heuristic with a short evidence note.
4. Severity-rank findings; cite the violated law or checklist item.
5. Propose the smallest fix that restores the heuristic.
6. Assess whether each acceptance criterion is observable and covered by mocks.

## Findings

- Hard findings block the verdict when unresolved.
- "Looks fine" is not a finding; missing evidence is unmet.

## Boundaries

Do not edit tracked source. Route defects back to the design stage.
