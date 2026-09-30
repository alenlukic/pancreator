## Objective

Convert the operator request into one ratifiable planning artifact: a faithful
product specification, an implementation-ready engineering plan, testable
acceptance criteria, and an executable test plan. One operator gate ratifies
the whole artifact before any source changes.

## Steps

1. Read the operator request referenced by the card.
2. Write the product specification first: summary, user stories with ids
   (`US-*`), constraints, out-of-scope behavior, and open questions. Preserve
   the operator's intent; do not broaden, narrow, or invent material scope.
3. Dispose of every open question you raised. Answer a question only from
   evidence you actually read, and cite it. When a question asks what a prior
   change removed, added, or previously guaranteed, read that change's own
   history — its commit, diff, or pull request — because the current workspace
   cannot show what a change deleted. When evidence does not settle a question,
   defer it with the decision named for implementation, or escalate it for an
   operator decision. Do not answer it by assumption.
4. Choose the smallest coherent architecture that satisfies the specification.
5. Name the approach, components, likely files, dependencies, risks, migration
   concerns, and validation methods.
6. Write acceptance criteria with ids (`AC-*`). Map each criterion back to a
   user story and forward to a verification method with an expected result.
   Tag each criterion with exactly one `proof` type:
   - `live`: the criterion changes a browser or app surface, so QA must check
     it live.
   - `observe`: it needs an operator's live observation or a production signal
     after ship. Verify defers it.
   - `test`: a gate lane can prove it. Prefer `test` whenever one can.
   - `review`: reading the code proves it, such as structure, wording, or docs.
7. Write the test plan for the `live` criteria only: for each one, at least one
   concrete verification case a later stage can execute against the workspace
   without editing source. State the setup, the action, and the expected
   observation. QA runs only for `live` criteria and executes these cases
   independently of the implementer, so write them against observable
   behavior, not implementation internals. A `test`, `review`, or `observe`
   criterion needs no case: gate evidence, the review, or a post-ship signal
   proves it.

## Output

Populate `data.product_spec` (`summary`, `user_stories`, `constraints`,
`out_of_scope`, `open_questions`), `data.engineering_plan` (`approach`,
`components`, `files`, `risks`, `validation`), `data.acceptance_criteria`,
`data.test_plan`, and `data.open_question_dispositions`. Each disposition
states the question `id`, a `disposition` of `resolved`, `deferred`, or
`escalated`, an `answer` naming the answer or the decision still required, and
`evidence`, which is required and must be non-empty for a resolved question.
Each acceptance criterion states `id`, `maps_to`, `verification` (`method`,
`expected`), and `proof`, and the validator rejects a criterion without a valid
`proof` with `plan.proof_missing`. Each test-plan entry states `id`, the `live`
acceptance criterion it verifies (`criterion`), `setup`, `action`, and
`expected`, and the validator rejects a `live` criterion without a case with
`plan.live_case_missing`. A test-plan case must not run
a configured repository-check profile command or `pan repository-check
<profile>`. The gates run those profiles, and the validator rejects such a case
with `plan.case_reruns_profile`. Follow the card's `output.operator_brief` contract.

If the change warrants a different verification level than the card shows, set
`data.verification_recommendation` to
`{ "level": <name>, "reason": <why> }`. The operator decides; do not assume
the change.

## Done when

The specification faithfully covers the request, every open question has a
recorded disposition whose resolutions rest on cited evidence, every
requirement maps to a testable acceptance criterion with one proof type,
every `live` criterion has an executable test-plan case, the plan needs no
further architectural decisions, and it minimizes new structure.
