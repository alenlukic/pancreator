# Iterate on tests

Applies during implementation and remediation.

## Procedure

1. After each group of changes, run the impacted iteration profile plus every test you added. In self-development use `pan tests impacted`. In a target installation use its declared impacted profile. Only when no impacted profile exists, select tests in the immediate blast radius by judgment.
2. Derive every command from `runtime/repository-checks.json` or the target's documented test entry points. Do not guess commands. You may run the static profile freely. Prefer `pan tests impacted` or `pan repository-check <profile> --run <run-id>` for concise results and a full log path. Do not pipe raw suite output into context.
3. When a changed path yields no impacted test, choose a judgment cohort that covers it. Record each unreached path and its cohort. An empty selection does not prove an absent blast radius. Cohort selection is judgment-only.
4. Leave the fast profile and integration lane to the exit gates. When the impacted selection, added tests, and static checks pass, submit. On a gate retry, fix the cause and rerun only the impacted selection, failing tests, and added tests.
5. Every other test execution uses the impacted profile plus added tests. Do not replace the impacted selection with a guessed blast radius. This saves worker turns and context because the gates rerun the profiles. In a session without an exit gate, run fast once as final validation.

## Hard constraints

The binding policy prohibits the full profile and prohibits fast when an exit gate runs it. Its evidence and retry duties still apply.
