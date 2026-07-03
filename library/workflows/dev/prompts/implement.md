## Objective

Implement the approved engineering plan and acceptance criteria with focused
tests, keeping changes scoped. A retry is a remediation pass and MUST change the
work or evidence that caused the prior failure.

## Steps

1. Read the plan, acceptance criteria, card, target-repository primer,
   `runtime/repository-checks.json`, and each required pre-implementation
   repository-check baseline before editing.
2. Confirm the baseline state of the configured `static` and `fast` profiles.
   The harness records these profiles before the first coder invocation. If a
   baseline is missing, run the profile before editing and disclose the missing
   harness evidence.
3. Existing baseline failures MUST be fixed when the repair is bounded and
   low-risk. They do not block the run when unchanged and remediation would be
   broad, structural, or unrelated to the approved change, but the implementation
   MUST NOT add or worsen diagnostics.
4. If this is a remediation or restart attempt, review the existing workspace
   changes, prior implementation output, deterministic evidence, review or QA
   findings, and operator feedback. Directly remediate every issue causing the
   loop; do not submit a paperwork-only retry.
5. Implement the smallest coherent change, adding tests at the right boundary.
6. Preserve behavior outside the requested change.
7. Iterate with the narrowest verified repository commands. Use explicit
   repository-declared toolchain entrypoints and the configured probes; do not
   substitute an ambiguous PATH interpreter or guess a package manager.
8. Let the harness rerun the configured `static` and `fast` repository-check
   profiles. `fast` must remain the target's documented default/primary suite;
   do not substitute `full` merely because it is available. Report an
   unconfigured profile rather than describing it as a pass.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`, mapping evidence to each acceptance criterion. On
attempt 2 or later, also populate non-empty `data.implementation.remediation`
entries with `cause`, `action`, and `evidence` for every issue responsible for
the retry. Author the implementation summary as the invocation's schema-valid
brief JSON, render it to the exact HTML path from the output contract, and
reference the HTML first and the brief JSON second.

## Done when

Every acceptance criterion has supporting evidence; configured static and fast
checks either pass or report only baseline-equivalent pre-existing failures; no
new or worsened diagnostics exist; retry causes have been directly remediated;
any unconfigured checks are disclosed; and no unsupported completion is
claimed.
