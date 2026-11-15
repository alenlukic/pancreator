## Objective

Write one proportionate plan for this medium task. One operator gate
ratifies it before any source change. Do not write a cohort plan. Do not
re-derive the intake classification.

## Steps

Treat structured plan data as the authority for repeated identifier
registries and acceptance criteria. Use explicit objects, for example
`{ "id": "C-1", "statement": "Preserve the original requirement." }`, for
new stories, constraints, exclusions, and questions.

1. Read the operator request the card delivers. Honor the intake record
   already on disk. Do not recompute size class, route, or layers.
2. Write the product specification: summary, user stories with ids
   (`US-*`), constraints, out-of-scope behavior, and open questions. Open
   every constraint, out-of-scope statement, and open question with its
   identifier (`C-*`, `OOS-*`, `Q-*`). Preserve the operator's intent.
3. Dispose of every open question you raised. Answer only from evidence.
   Record deferred or escalated when you cannot answer.
4. Write an implementation-ready engineering plan: approach, components,
   likely files, interfaces, risks, and validation. Prefer existing
   abstractions. Keep the plan sized for one M task.
5. Map every user story to at least one testable acceptance criterion.
   Give every criterion exactly one proof type: `test`, `review`, `live`,
   or `observe`.
6. List every test scenario in `data.test_scenarios`. Each scenario
   carries `id`, `criterion`, `category`, and `scenario`. Use exactly one
   of `happy_path`, `critical_unhappy_path`, `probable_edge_case`, or
   `hidden_edge_case`. Cover a happy path and a mission-critical unhappy
   path when those exist. Do not plan low-probability low-impact,
   vanishingly improbable, or provably unreachable cases.
7. Give every `live` criterion at least one test-plan case with setup,
   action, and expected observation.
8. Record the minimum shared test-facing interface contract in
   `data.interface_contract.interfaces`. Each entry has `id`, `kind`
   (`existing`, `new`, or `changed`), `reference` (existing path/symbol or
   planned import path, endpoint, or CLI entry point), `surface` (how to
   invoke it, inputs, outputs, errors), `effects` (observable behaviors),
   `test_seams` (existing observation points or necessary test access), and
   `scenario_ids` (the planned scenarios exercising it). The last three
   fields are arrays of non-empty strings. Every planned scenario maps to
   at least one interface. An empty interface list is valid only when no
   test scenarios exist. Reference existing interfaces and any supplied
   approved prototype-trace schema instead of duplicating definitions.
   Specify only what tests need to observe; do not design private helpers,
   algorithms, or dependencies unless an explicit constraint requires them.
   No skeleton implementation or separate schema artifact is required.
   Resolve uncertainty from existing repository conventions. Escalate a
   material unresolved interface decision rather than inventing a contract.
9. Omit `data.cohort_plan`. This run is one chunk.
10. When the card lists a design stage output, record `data.design_plan`
    with the planning stage, verification stage, and evidence roles.

If concrete new evidence shows the implementation exceeds the M hard max
(1000 implementation SLOC), or reveals an unplanned new integration point,
stop and return `blocked`. Record the evidence and recommend decomposition or
prototype-trace, respectively. Set `data.blocked.supplying_command` to the
appropriate `pan intake classify --reason <reason>` command; the supervisor
reclassifies and the operator owns the reroute. Do not silently expand the plan.
If supplied an approved interface schema, read it as the contract before planning.

## Output

Write the stage output the card names. Populate every required data
field. Do not invent material scope.
