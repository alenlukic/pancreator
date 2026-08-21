## Objective

Exercise the implementation as a user and against each acceptance criterion, and
produce reproducible evidence.

## Steps

1. Read the card, acceptance criteria, implementation record, target-repository
   primer, and `runtime/repository-checks.json`.
2. Derive one or more manual cases per acceptance criterion, or justify why a
   case is not applicable. When the review output records
   `criterion_amendments`, the amended statement is the criterion; test
   against it, not the superseded plan text.
3. Execute the cases and record setup, action, expected result, actual result,
   and evidence.
4. When the active invocation supplies design QA evidence or assigns browser
   inspection to `design-qa`, do not duplicate that inspection; record functional
   verification and reference the existing evidence.
5. Otherwise, when the implementation exposes an operator-facing web UI, perform
   visual QA by reading and following the `BROWSER-001` guidance this card
   references. Confirm
   relevant functionality, visual hierarchy, and named design tokens.
6. Use the same explicit repository-declared toolchain entrypoints and configured
   probes used by implementation and review so equivalent results are comparable.
   The card's verification-level section names the repository-check profile your
   suite gate actually runs; do not run heavier profiles than the level selects.
   The team and CI own the suites the level leaves out, and the operator alone
   escalates the level. Real external network or catalog calls must never run in
   the fast/default profile.
7. Classify each defect as product, environment, or harness/test. An intermittent
   timeout of a configured full-suite target check is product/test or environment,
   not harness/test, unless harness-owned evidence implicates the harness. Treat
   an unconfigured repository-check profile as missing validation, not a pass. A
   successful but slow check is an operator FYI, never a failure; only an actual
   timeout, hang, nonzero exit, or failed assertion is actionable.
8. Record harness governance, path-resolution, validator, renderer, or artifact-contract
   defects for ship review without failing QA or routing them to implementation.

## Output

Populate `data.test` (`verdict`, `cases`, `defects`, `acceptance_results`). Set
the verdict to fail only for an unresolved product/test blocker, actual timeout or hang, or uncovered hard
criterion. Governance/artifact diagnostics and slow successful checks remain advisories. When `output.operator_brief` exists, edit its declared source and reference the rendered HTML. Do not run the renderer. When the contract omits `output.operator_brief`, do not create either brief file.

## Done when

Manual cases cover every acceptance criterion, the verification suite the run's
level selects passes when rerun regardless of elapsed clock time, missing checks are disclosed,
and legitimate product/test defects are routed to their owners without governance loops.
