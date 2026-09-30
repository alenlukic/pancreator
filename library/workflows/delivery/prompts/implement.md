## Objective

Implement the ratified plan with focused tests, and map evidence to every
acceptance criterion.

## Steps

1. Read the ratified plan. The plan is the `plan` stage output when the card
   lists one under its required inputs, otherwise the request the card
   delivers. A request that is the plan is the child specification with its
   objective, scope, acceptance criteria, dependencies, validation, and handoff
   contract. Read the parent specification only through the audited context
   reference the card lists, when its read trigger applies. In the rest of
   this prompt, "the plan" means that document.
2. Read `runtime/repository-checks.json` and the target's documented test entry
   points. Derive every test command from them. Do not substitute guessed
   ecosystem commands.
3. Implement the plan within its declared scope. Prefer existing abstractions;
   do not add structure the plan did not call for.
   When a plan file entry lists `symbols`, look them up in the function index
   (`docs/function-index/`) when the repository carries one, and open the
   source at the `file:line` each entry gives.
4. Add or update tests that prove the changed behavior. Do not weaken, skip,
   or delete existing tests to make the change pass; a needed test change must
   be disclosed in the notes with its reason.
   Use the `checkpoint` helper for driven workflow runs and the read-only
   `sharedFixture` as the default fixtures. Keep isolated logic in the unit
   lane, fixture or subprocess behavior in integration, and slow installer or
   release paths in secondary.
5. After each group of changes, run the declared `impacted` profile plus any
   tests you added. In self-development that is `./bin/pan tests impacted`
   (static import-graph analysis selects the test modules your change set
   reaches). In a target installation, use the target's `impacted` profile
   from `runtime/repository-checks.json`. Only when no `impacted` profile is
   declared, pick the tests in the immediate blast radius yourself from the
   target's documented entry points. Run each profile through the compact
   wrappers and follow the output and tool habits that `DEV-001` on your card
   states. Static checks are cheap. Run them freely.
6. The gates own the suites. Do not run the `fast` profile or the integration
   lane yourself. When the impacted selection, your new tests, and the static
   checks pass, submit. The implement exit gate runs the stage's declared gate
   profiles, which the card lists, and a failure returns the stage to you with
   its log. This saves worker turns and context. The gate reruns every
   profile anyway.
7. On a retry, read the handoff artifact the card lists first. It carries
   the previous worker's notes and the files and lines it read and edited, so
   open those files at those lines instead of exploring again. After a gate
   failure, also start from the failing gate's log that the card lists. Fix the cause, re-run the impacted selection and the failing
   tests, then submit. On a retry that changed only output claims or
   evidence, do not run any suite. Cite the prior run's evidence instead.
8. Map evidence to every acceptance criterion honestly. Report a criterion you
   could not satisfy as unmet; do not claim unsupported completion.

## Output

Populate `data.implementation` (`changed_files`, `tests_added`, `notes`) and
`data.acceptance_results`. Each `tests_added` entry is `{ path, contract }`:
the test file path and one sentence that names the contract the test proves.
Every new test file and every net-positive test delta needs an entry. A change
with no new tests leaves `tests_added` empty. Each acceptance result states the criterion `id`,
a `result`, and non-empty `evidence`. On a retry attempt, also populate
`data.implementation.remediation` with one entry per prior failure cause:
`cause`, `action`, and non-empty `evidence`. If implementation cannot start
because a required precondition is unavailable, return `result: blocked`, leave
`data.acceptance_results` empty, and populate `data.blocked` with a non-empty
`missing_precondition`, the `supplying_command` that would provide it, and
non-empty `evidence` (paths, commands, or observations) for the gap. Do not
claim implementation fields for blocked work. When you edited tracked files
before you stopped, list every such path in top-level `workspace_changes.paths`
with `attribution: internal`; the claims validator reconciles that list against
the Git delta. Also populate `data.implementation.handoff` for whoever works on this change
next: `start_here` (`{ path, symbol_or_lines, why }`, where a follow-up worker
should begin), `symbols_changed` (`{ path, symbol, lines, note }`),
`decisions` (one line each), and `untested` (what you did not prove). Keep it
short. A retry or a remediation receives it together with the harness's
reading map of your transcript. Follow the card's `output.operator_brief`
contract.

## Done when

The plan is implemented within scope, the static checks, the impacted
selection, and your new tests pass, tests prove the changed behavior, and
every acceptance criterion has an honest evidence-backed result.
