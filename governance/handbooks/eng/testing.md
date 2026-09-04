# Testing handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC 2119 meanings.

This handbook defines how Pancreator self-development tests earn their place in the suite. It applies to coders, remediators, reviewers, QA testers, and verifiers. No count budget or duration ceiling decides compliance. Duration supports a MERGE or DEMOTE verdict only after signal and contract analysis support that verdict.

## Principles

### TP-01 · Unique contract value

Each test MUST prove one contract that no other test already proves. When two tests overlap, merge them or delete the weaker one. A contract is the behavior an operator or gate would miss if the test disappeared.

### TP-02 · Assertion search

Before adding a test, search the suite for the same contract under another name, file, or lane. Prefer extending an existing test when the contract already has a home.

### TP-03 · Cheapest truthful proof

Choose the cheapest proof that still fails when the contract breaks. Prefer a unit test over an integration test, and an integration test over an end-to-end replay, when the contract does not cross the boundary you would need to exercise.

### TP-04 · State transitions

When the contract is a state change, assert the resulting state or observable output, not incidental log text. Pin the transition with the narrowest fixture that still reaches the branch.

### TP-05 · Prose pins

Do not assert verbatim policy or persona prose unless the contract is the exact wording itself. Prefer structural checks, stable identifiers, and resolved paths over byte-for-byte prose equality.

### TP-06 · Schema duplication

Do not duplicate schema or registry shape checks that a dedicated validator already owns. A test MAY cover orchestration around a validator; it MUST NOT re-encode the validator's full rule set.

### TP-07 · Gate duplication

Do not replay a whole repository-check profile inside a unit test when the gate already runs that profile. Test the local decision or transformation the gate depends on.

### TP-08 · Fixture cost

Keep fixture setup proportional to the contract. Share templates across tests in one file. Record template-build and clone cost only when profiling is active; normal runs MUST stay unchanged.

### TP-09 · Scratch space

Allocate fixture scratch space with `createTestTempDirectory` from `tests/temp.ts`. It lives under `runtime/tmp/tests/`, per root and so per worktree, and `bin/run-tests` removes it when the run ends. A test MUST NOT call `tmpdir()`: the shared OS temp directory is unbounded, every program on the host pays for what accumulates there, and a fixture placed in it outlives the run that made it.

## Lanes

Place each test in the documented lane that matches its cost and boundary:

- **Unit** — isolated logic, no subprocess, no network.
- **Integration** — cross-module or CLI behavior with bounded fixtures.
- **Regression** — replay of a prior defect with a minimal reproduction.
- **Secondary** — slow installer or release paths the mainline lane excludes.

A DEMOTE recommendation MUST name a documented lane destination or a cheaper direct form that still proves the contract.

## Verdict vocabulary

Review and tune workflows use these verdicts against current tests:

| Verdict | Meaning                                                  |
| ------- | -------------------------------------------------------- |
| KEEP    | The test proves a unique contract at an acceptable cost. |
| MERGE   | Overlaps another test; one survivor MUST remain.         |
| DEMOTE  | The contract belongs in a slower lane or cheaper form.   |
| DELETE  | No unique contract remains; name a permitted sub-reason. |

Every verdict MUST cite at least one TP identifier and concrete test evidence. Cost alone MUST NOT decide a verdict.
