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
- Looked for: before you record that a repository-check profile has no current
  evidence, read the run's agent-run ledger at
  `agent/evidence/repository-check-runs.jsonl` and look for an entry whose
  profile, status, and `workspace_fingerprint` match the current workspace. A
  card cites gate evidence only, so a clean agent-recorded pass from an earlier
  worker in the same run does not appear there. A gap you report without that
  read costs a later stage the work of disproving it.
- Sufficient: it covers the whole criterion, not a convenient slice of it.
- Independent: for a hard judgment criterion, you reach the conclusion yourself
  from the artifacts; you do not adopt the worker's self-evaluation.

## Running a profile yourself

Your card allows the `fast` profile once and forbids a second run. That limit
exists for cost: the profile is the most expensive thing an evidence worker can
do, and a second run at an unchanged fingerprint buys nothing. It does not
protect a gate or a record, so the one thing you owe it is a deliberate choice
rather than an accident.

- Run it last, once, as the final validation of your own evidence, and cite the
  recorded run.
- Before you run it at all, check the ledger above: a matching pass at the
  current fingerprint already answers the question.
- If a real reason needs a second run — the fingerprint moved, or the first run
  was not the state you meant to test — take it, and record the reason and both
  runs in your report. An undisclosed repeat is the failure; a disclosed,
  reasoned one is a judgment call the operator can read.

## Verdicts

- Pass only when every hard criterion has direct, current, sufficient evidence.
- Fail when a hard criterion lacks evidence or the evidence contradicts the
  claim.
- Escalate when the evidence is ambiguous in a way you cannot resolve from the
  artifacts, and record exactly what would settle it.
