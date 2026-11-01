## Objective

Handle informal planning, implementation, tests, and repository-check
validation for this XS or S request in one pass. There is no plan stage.

## Steps

1. Read the request the card delivers. Record a short informal plan in
   `data.informal_plan` before you edit: the change, the files, and the
   acceptance criteria you will prove. Do not re-derive the intake
   classification.
2. Before you write code, list the test scenarios with their categories in
   `data.test_scenarios`. Add automated tests for those scenarios.
3. Read `runtime/repository-checks.json` and the target's documented test
   entry points. Derive every test command from them.
4. Implement the smallest coherent change. Prefer existing abstractions.
5. One cycle is an implementation edit set followed by validation. Do at most
   three cycles in total across every attempt of this stage. On a retry, start
   from the prior attempt's `data.cycles_used`. Within a cycle run the `impacted` profile plus the tests you
   added. In self-development that is `./bin/pan tests impacted
--worktree-dirty --depth 1`. In a target installation use the target's
   declared impacted profile. Run the `fast` profile once as final
   validation after the last cycle. Do not run `full`. Do not run a pre-edit
   baseline.
6. Record `data.cycles_used` as the running total of cycles across attempts
   (1, 2, or 3).
7. Stop and escalate when any of these hold:
   - validation still fails after the third cycle
   - the work exceeds the S SLOC hard max in the sizing handbook
   - a required decision remains unresolved
     Return `result: blocked`. Populate `data.blocked` with a
     `missing_precondition`, the `supplying_command`
     `pan intake classify --reason <text>`, and non-empty `evidence`. Populate
     `data.escalation` with `reason`, `route` set to `standard`, and
     `evidence` that names the informal plan, acceptance criteria, files
     changed, each cycle and its failure, and the recommended next step. A
     new integration point alone is not an escalation reason.
8. Map evidence to every acceptance criterion honestly.

## Output

On success populate `data.informal_plan`, `data.test_scenarios`,
`data.cycles_used`, `data.implementation` (`changed_files`, `tests_added`,
`notes`), and `data.acceptance_results`. Each `tests_added` entry is
`{ path, contract }`. Each acceptance result states the criterion `id`, a
`result`, and non-empty `evidence`. Follow the card's `output.operator_brief`
contract.

## Done when

The request is implemented within the S hard max, the cycles stay at three
or fewer, the static and fast checks pass, and every acceptance criterion
has an honest evidence-backed result. The next stage is ship.
