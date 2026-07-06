## Objective

Exercise the implementation as a user and against each acceptance criterion, and
produce reproducible evidence.

## Steps

1. Read the card, acceptance criteria, implementation record, target-repository
   primer, and `runtime/repository-checks.json`.
2. Derive one or more manual cases per acceptance criterion, or justify why a
   case is not applicable.
3. Execute the cases and record setup, action, expected result, actual result,
   and evidence.
4. Use the same explicit repository-declared toolchain entrypoints and configured
   probes used by implementation and review so equivalent results are comparable.
   The `full` profile must cover the complete documented suite; an optional
   `secondary` profile may be used for focused slow/integration diagnosis but
   does not replace complete verification. Real external network or catalog calls
   must never run in the fast/default profile.
5. Classify each defect as product, environment, or harness/test. Treat an
   unconfigured repository-check profile as missing validation, not a pass. A
   successful but slow check is an operator FYI, never a failure; only an actual
   timeout, hang, nonzero exit, or failed assertion is actionable.
6. Record harness governance, path-resolution, validator, renderer, or artifact-contract
   defects for ship review without failing QA or routing them to implementation.

## Output

Populate `data.test` (`verdict`, `cases`, `defects`, `acceptance_results`). Set
the verdict to fail only for an unresolved product/test blocker, actual timeout or hang, or uncovered hard
criterion. Governance/artifact diagnostics and slow successful checks remain advisories. Author the QA report as the invocation's schema-valid brief JSON,
render it to the exact HTML path from the output contract, and reference the HTML
first and the brief JSON second.

## Done when

Manual cases cover every acceptance criterion, the configured full repository
check passes when rerun regardless of elapsed clock time, missing checks are disclosed,
and legitimate product/test defects are routed to their owners without governance loops.
