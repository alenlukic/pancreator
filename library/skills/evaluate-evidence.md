# Evaluate evidence

Use when judging whether a stage's evidence actually supports a criterion: at a
supervisor assessment, in review, or in QA.

## Principle

Evidence is what someone else could re-check, not what a worker asserts. A
success claim is a hypothesis; the evidence is the test of it.

## Checklist

- Direct: the evidence shows the behavior or property itself, not a summary of
  it. A passing command's captured output beats "tests pass."
- Reproducible: another operator could rerun it and observe the same result.
- Current: it belongs to the recorded workspace fingerprint. Evidence from an
  earlier state is stale and does not count.
- Sufficient: it covers the whole criterion, not a convenient slice of it.
- Independent: for a hard judgment criterion, you reach the conclusion yourself
  from the artifacts; you do not adopt the worker's self-evaluation.

## Verdicts

- Pass only when every hard criterion has direct, current, sufficient evidence.
- Fail when a hard criterion lacks evidence or the evidence contradicts the
  claim.
- Escalate when the evidence is ambiguous in a way you cannot resolve from the
  artifacts, and record exactly what would settle it.
