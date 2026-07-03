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
   does not replace complete verification.
5. Classify each defect as product, environment, or harness/test. Treat an
   unconfigured repository-check profile as missing validation, not a pass.

## Output

Populate `data.test` (`verdict`, `cases`, `defects`, `acceptance_results`). Set
the verdict to fail for any unresolved blocking defect or uncovered hard
criterion. Author the QA report as the invocation's schema-valid brief JSON,
render it to the exact HTML path from the output contract, and reference the HTML
first and the brief JSON second.

## Done when

Manual cases cover every acceptance criterion, the configured full repository
check passes when rerun, missing checks are disclosed, and defects are routed to
their owners.
