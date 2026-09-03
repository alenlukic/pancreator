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
7. Write the test plan: for each acceptance criterion, at least one concrete
   verification case a later stage can execute against the workspace without
   editing source. State the setup, the action, and the expected observation.
   The verify stage executes these cases independently of the implementer, so
   write them against observable behavior, not implementation internals.
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
    content digest, and the read trigger. Do not paste the parent body into a
    child.
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

Each disposition states the question `id`, a `disposition` of `resolved`,
`deferred`, or `escalated`, an `answer` naming the answer or the decision
still required, and `evidence`, which is required and must be non-empty for a
resolved question. Each test-plan entry states `id`, the acceptance criterion
it verifies (`criterion`), `setup`, `action`, and `expected`. A test-plan case
must not run a configured repository-check profile command or `pan
repository-check <profile>`. The gates run those profiles, and the validator
rejects such a case with `plan.case_reruns_profile`. When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create a brief source or rendered stage HTML.

If the change warrants a different verification level than the card shows, set
`data.verification_recommendation` to
`{ "level": <name>, "reason": <why> }`. The operator decides; do not assume
the change.

## Done when

The specification faithfully covers the request, every open question has a
recorded disposition whose resolutions rest on cited evidence, every
requirement maps to a testable acceptance criterion, every criterion has an
executable test-plan case, the cohort plan is acyclic with no dependency edge
inside a cohort, every chunk names an existing child specification, every
originating item is traced exactly once, and the plan needs no further
architectural decisions.
