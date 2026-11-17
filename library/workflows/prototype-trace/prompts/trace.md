## Objective

Produce skeletons, trace tests, and a machine-readable interface schema
for this new-integration task. The operator approves the schema before
any later standard or decomposition work starts from it.

## Steps

1. Read the request the card delivers. List every new function and
   endpoint the task introduces.
2. Write a skeleton for each one: signature, expected input and output
   shapes, and a docstring or usage spec. Stub bodies return shape-valid
   data or fail explicitly as not implemented.
3. Write trace tests at each new boundary, using test data. Include at
   least one end-to-end or integration path through every layer the
   task touches.
4. Write the interface schema in the target stack's idiom (JSON Schema,
   OpenAPI, or exported types) plus short usage notes. Place it at a
   repository path you declare in `data.interface_schema.path`. Version
   the file with the code.
5. Keep claimed skeleton names and signatures identical to the schema
   file. When an interface changes, update the schema in the same
   change.
6. Run the `static` profile from `runtime/repository-checks.json`.
   Repair a new static or type diagnostic before submission. Confirm the
   `trace` repository-check profile runs the file in
   `$PANCREATOR_TRACE_TEST_FILE` and fails when no tests are collected.
   The harness executes each declared trace test file at submission. If the
   target lacks that runner, report the missing configuration rather than
   guessing a command or claiming a pass.

## Output

On success populate `data.skeletons`, `data.trace_tests`, and
`data.interface_schema` (`path`, `idiom`, `notes`). Each skeleton
states `name`, `signature`, `path`, `expected_input`,
`expected_output`, and `stub`. Each trace test states `id`, `path`,
and `kind`. At least one `kind` is `e2e` or `integration`. Follow the
card's `output.operator_brief` contract.

## Done when

Skeletons, trace tests including one end-to-end path, and the schema
file are in the repository, claimed signatures match the schema, and
static checks and the harness-owned trace test executions pass. The run
then waits for operator approval of the schema and validated artifacts.
