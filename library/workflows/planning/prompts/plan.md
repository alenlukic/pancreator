## Objective

Convert the operator request into one ratifiable planning artifact: a faithful
product specification, an implementation-ready engineering plan, testable
acceptance criteria, an executable test plan, and a cohort plan that carves the
work into chunks a later delivery run can execute in parallel. One operator
gate ratifies the whole artifact before any source changes.

## Steps

1. Read the operator request referenced by the card.
2. Write the product specification first: summary, user stories with ids
   (`US-*`), constraints, out-of-scope behavior, and open questions. Open
   every constraint, out-of-scope statement, and open question with its
   identifier (`C-*`, `OOS-*`, `Q-*`); the child specifications trace those
   identifiers, and the validator rejects an item without one. Preserve the
   operator's intent; do not broaden, narrow, or invent material scope.
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
8. Carve the ratified scope into chunks. A chunk owns one coherent operator
   outcome, carries independently testable acceptance criteria, and reaches a
   valid standalone completion state. Default to one chunk. Split only when
   each proposed chunk clears that independence bar and the reduction in
   implementation and review risk outweighs the added coordination cost of one
   more delivery run.
9. Record the dependency edges between chunks. The edges form a directed
   acyclic graph. Then group the chunks into sequential cohorts numbered from
   1: no chunk in a cohort depends on another chunk in the same cohort, and a
   chunk depends only on chunks in earlier cohorts.
10. Write one parent specification at
    `runtime/logs/workflows/<run-id>/operator/specs/parent-specification.md`.
    It holds the complete record of the request: every requirement,
    constraint, out-of-scope statement, and open question.
11. Write one child specification per chunk at
    `runtime/logs/workflows/<run-id>/operator/specs/<chunk-id>.md`. Each child
    carries these sections: `Objective`, `In scope`, `Out of scope`,
    `Acceptance criteria`, `Dependencies`, `Validation`, and
    `Handoff contract`. Each child opens with a `Parent specification`
    reference block that names the parent path, the selected range, the
    content digest, and the read trigger. Take the content digest from
    `pan context digest <parent-path>`. Run it from the harness root. The
    card's **Harness root** line names it when present. Otherwise the card's
    **Workspace** is the harness root. Do not compute it by hand. The
    validator rejects a digest on another basis and names the expected value.
    Do not paste the parent body into a child. Write each criterion line of
    the child `Acceptance criteria` section as its id, then its plan proof
    tag, then the statement: `1. AC-01 [proof: live] <statement>`. Use the
    criterion's `proof` from the plan JSON; the validator rejects a missing
    or different tag. The chunk run reads it to decide whether QA runs.
12. State the authority relationship in every child specification: the child
    governs the chunk's own scope, the parent governs system-wide context, the
    child wins for its own scope, and the parent wins for cross-chunk context.
13. Trace every requirement, constraint, out-of-scope statement, and open
    question of the request exactly once across the child specifications, as
    owned, shared, or deferred. The parent keeps the complete record. One
    chunk owns an item by naming its identifier in the child `In scope`
    section. List an item that several chunks legitimately carry in
    `data.cohort_plan.shared_items`, and name it in the `In scope` section of
    every chunk that carries it. Dispose an item no chunk carries as
    `deferred` or `escalated`.
14. When the plan holds one chunk, record `serial_justification` in the cohort
    plan and state why the work stays serial.

## Output

Populate `data.product_spec` (`summary`, `user_stories`, `constraints`,
`out_of_scope`, `open_questions`), `data.engineering_plan` (`approach`,
`components`, `files`, `risks`, `validation`), `data.acceptance_criteria`,
`data.test_plan`, `data.open_question_dispositions`, and `data.cohort_plan`.

`data.cohort_plan` states `parent_spec_path`, `chunks`, `edges`, and
`cohorts`, plus `serial_justification` for a single-chunk plan. Each chunk
states `id`, `cohort_index`, `child_spec_path`, `depends_on`, and `title`.
Each edge states `from` and `to`, naming chunk ids. Each cohort states
`index` and `chunks`, naming the chunk ids of that cohort. `shared_items`
lists the identifiers of the originating items several chunks carry, and it is
omitted when every item has one owner.

On a design-composed run the card also requires `data.design_plan`. It records
where design work sits for the plan you wrote: `planning_stage` names the stage
that produced the design specification and mocks, `verification_stage` names the
stage that verifies the implemented UI against them, and `evidence_roles` lists
the design evidence-worker roles that run there. The design stage's draft design
acceptance criteria belong to the artifact one operator gate ratifies, so carry
each one into `data.acceptance_criteria` with its own `AC-*` id, a `proof` of
`live` when it checks the rendered UI, and at least one test-plan case, and give
it an owning chunk. Do not leave a design acceptance
criterion in the design output alone.

Each disposition states the question `id`, a `disposition` of `resolved`,
`deferred`, or `escalated`, an `answer` naming the answer or the decision
still required, and `evidence`, which is required and must be non-empty for a
resolved question. Each acceptance criterion states `id`, `maps_to`,
`verification` (`method`, `expected`), and `proof`, and the validator rejects a
criterion without a valid `proof` with `plan.proof_missing`. Each test-plan
entry states `id`, the `live` acceptance criterion it verifies (`criterion`),
`setup`, `action`, and `expected`, and the validator rejects a `live`
criterion without a case with `plan.live_case_missing`. A test-plan case must
not run a configured repository-check profile command or `pan
repository-check <profile>`. The gates run those profiles, and the validator
rejects such a case with `plan.case_reruns_profile`. Follow the card's `output.operator_brief` contract.

If the change warrants a different verification level than the card shows, set
`data.verification_recommendation` to
`{ "level": <name>, "reason": <why> }`. The operator decides; do not assume
the change.

## Done when

The specification faithfully covers the request, every open question has a
recorded disposition whose resolutions rest on cited evidence, every
requirement maps to a testable acceptance criterion with one proof type,
every `live` criterion has an executable test-plan case, the cohort plan is
acyclic with no dependency edge inside a cohort, every chunk names an existing
child specification whose criterion lines carry the plan's proof tags, every
originating item is traced exactly once, and the plan needs no further
architectural decisions.
