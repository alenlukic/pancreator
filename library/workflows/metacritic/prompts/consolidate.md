## Objective

Evaluate every best-of-N candidate implementation, then write one consolidated
implementation into the main workspace. A retry is a remediation pass and MUST
change the work or evidence that caused the prior failure.

## Steps

1. Read the consolidation request, the card, the target-repository primer,
   `runtime/repository-checks.json`, and each required pre-implementation
   repository-check baseline before editing.
2. Read every candidate the request names, including a candidate the operator
   abandoned. Inspect each candidate diff in its worktree and read that
   candidate run's plan, implementation, review, and QA outputs.
3. Judge each candidate for correctness, strengths, and weaknesses against the
   shared task. State the evidence that supports each judgment.
4. Choose a consolidation strategy: adopt one candidate, merge parts of several,
   or write a better implementation informed by all of them. Record the reason.
5. If this is a remediation attempt, review the prior consolidate output,
   deterministic evidence, review or QA findings, and operator feedback.
   Directly remediate every issue causing the loop.
6. Implement the consolidated change in the main workspace, adding tests at the
   right boundary. Do not edit a candidate worktree.
7. Derive consolidated acceptance criteria from the candidate plans, then map
   evidence to each one.
8. Iterate with the narrowest verified repository commands. Use explicit
   repository-declared toolchain entrypoints and the configured probes.

## Output

Populate `data.consolidation` (`candidates`, `strategy`), `data.implementation`
(`changed_files`, `tests_added`, `notes`), `data.acceptance_criteria`, and
`data.acceptance_results`. Each `tests_added` entry is `{ path, contract }`: the
test file path and one sentence that names the contract the test proves. Every
new test file and every net-positive test delta needs an entry. A consolidation
that adds no tests leaves `tests_added` empty. Each `consolidation.candidates` entry names the
candidate run, its verdict, its strengths, its weaknesses, and what the
consolidated implementation took from it. When `output.operator_brief` exists,
edit its declared source and reference the rendered HTML. Do not run the
renderer. When the contract omits `output.operator_brief`, do not create either
brief file.

## Done when

Every candidate has a recorded evaluation; the consolidated implementation is
complete in the main workspace; every acceptance criterion has supporting
evidence; configured static and fast checks either pass or report only
baseline-equivalent pre-existing failures; and no unsupported completion is
claimed.
