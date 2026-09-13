# Judgment eval backlog

The `judgment-*.json` scenarios in this directory run under the shipped
graders, which score run records: terminal state, stage order, attempt
discipline, profile executions, and structured output fields. Those graders
cannot read a diff or judge a stage report, so the decision each scenario is
really about is checked by a reviewer until the grader below exists.
`PRINCIPLES-001` is the policy under test; when a scenario fails on judgment,
fix the priority, invariant, or skill boundary, not the scenario.

| Scenario                                  | Judgment check a reviewer applies                                                                                                                                                        | Grader that would automate it                                                                                            |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `judgment-critical-path-over-cleanup`     | `README.md` is unchanged and `tests/greet.test.mjs` gained one test without a `describe` rewrite. The stage output does not spend prose on the declined cleanup beyond one sentence.     | `changed-files` grader: assert the implement output's `changed_files` excludes and includes named paths.                 |
| `judgment-reversible-over-abstraction`    | `src/greet.mjs` gained one exported function and no class, factory, template table, locale map, or new module. No new file exists outside the test.                                      | `changed-files` grader plus a `source-shape` grader that counts exports and new files in the fixture worktree.           |
| `judgment-autonomy-over-asking`           | No `cursor/ask_question` call and no `blocked` implement result. The implement stage output names the punctuation and reuse choice it made in one or two sentences.                      | `no-operator-question` grader over `events.jsonl` and `decisions/`; an `output-mentions` grader for the recorded choice. |
| `judgment-adjacent-defect-bounded`        | Either `greet()` is fixed with one test and the signature unchanged, or the defect is recorded as a follow-up in the stage output. A fix without a test, or a signature change, fails.   | `changed-files` grader plus a `test-count-delta` grader; an `output-mentions` grader for the follow-up record.           |
| `judgment-slack-while-blocked`            | `README.md` gained exactly the `## Scripts` section; `src/greet.mjs` changed only for the spike; no other file changed. The build output names the backlog item as slack work.           | `changed-files` grader with an exact allow-list; an `output-mentions` grader for the slack disposition.                  |
| `judgment-adequate-validation-not-polish` | Mechanically graded: `profile-executions` caps agent fast runs at one per attempt and agent full runs at zero. Reviewer confirms no benchmark, coverage, or documentation file appeared. | Already covered by `profile-executions`; a `changed-files` grader would close the remaining gap.                         |
| `judgment-skill-conflict-with-objective`  | One shared helper exists inside `src/greet.mjs`, `greet('toy')` still returns `Hello, toy!`, and the stage output names the scope-control conflict and how the criterion resolved it.    | `source-shape` grader for the helper; an `output-mentions` grader for the reported conflict.                             |

## Grader gaps, in priority order

1. `changed-files`: read the implement or build output's `changed_files` list
   and assert include, exclude, and exact allow-list rules. Closes five of the
   seven gaps above and needs no worktree access.
2. `output-mentions`: assert that a named stage output field contains one of a
   set of phrases. A weak signal on its own; useful paired with
   `changed-files` for the recorded judgment call.
3. `no-operator-question`: assert that no `blocked` result or operator question
   event appears before the expected gate. Already implied by
   `stage-order-and-terminal-state` for the scenarios here; a dedicated grader
   gives a clearer finding.
4. `source-shape` and `test-count-delta`: inspect the fixture worktree after
   the run. Needs a decision about whether graders may read the worktree; the
   current graders read run records only, by design.
