# Test scenario handbook

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** use RFC 2119 meanings.

This handbook defines which test scenarios agents plan and write, in self-development and in target installations. Test effort follows likelihood times impact. A scenario earns a test when its failure is likely or costly; it does not earn one because it exists.

## Categories

Every planned scenario and every added test MUST carry exactly one category. The `data.test_scenarios[].category` value names it.

| Category                          | Value                   | Meaning                                                                                               |
| --------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------- |
| (a) Happy path                    | `happy_path`            | The intended behavior under normal input.                                                             |
| (b) Mission-critical unhappy path | `critical_unhappy_path` | A failure the operator or a gate must see, such as refused input, a lost write, or a broken contract. |
| (c) Highly probable edge case     | `probable_edge_case`    | A boundary, empty, missing, or invalid state that ordinary use reaches.                               |
| (d) Hard-to-detect edge case      | `hidden_edge_case`      | A low-probability state, not vanishingly rare, whose failure would go unnoticed without a test.       |

## Exclusions

Agents MUST NOT plan or write a test for:

- **TX-1:** a low-probability, low-impact case;
- **TX-2:** a vanishingly improbable case, such as an act of god;
- **TX-3:** a provably unreachable case, such as one that a compile-time check or the type system excludes.

Agents MUST NOT pursue a coverage percentage for its own sake, and MUST NOT try to cover every edge case exhaustively, in planning or in test writing.

## Where scenarios live

- **Planned work:** the plan stage lists every scenario in `data.test_scenarios`. Each entry states `id`, the `criterion` it proves, its `category`, and the `scenario` in one sentence. A `live` criterion still needs its executable `data.test_plan` case.
- **One-shot work:** the single agent lists its scenarios, with categories, before it writes code, and records them in its output.
- **Added tests:** each `tests_added` entry names the scenario id or category it proves.

## Review

- The reviewer MUST report a planned scenario or an added test that fits no category, or that an exclusion covers, as excess.
- The reviewer MUST report a missing category (a) or (b) scenario for a criterion that has one as a defect.
- Category (c) and (d) gaps are judgment calls. The reviewer reports them only with a concrete reachable state.

## Independent test authoring

These rules bind when a workflow runs a test author beside the implementer.

- The test author works from the plan, the acceptance criteria, the scenarios, and the interface schema when one exists. It MUST NOT read the implementer's work in progress.
- When the interfaces and output shapes are known, for example from an approved interface schema, the test author MAY assume the implementer honors them. Otherwise it MUST assume reasonable interfaces and shapes and focus on covering every scenario correctly.

## Marshaling

Marshaling aligns test code with the actual interfaces and output shapes after implementation.

- Marshaling MAY change call sites, imports, names, and fixture shapes.
- Marshaling MUST NOT delete a scenario, loosen an assertion, or change an expected outcome.
- A behavioral mismatch between a test and the implementation is a defect for remediation, never a marshaling edit.
- Marshaling edits source, so it MUST run in a source-allowed step before the read-only verdict. The verify stage stays read-only.
