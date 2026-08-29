## Objective

Turn the operator request into a prototype brief: what technical question this
spike exists to answer, and what result would count as an answer.

This is not a product specification. A prototype brief frames a question; it
does not enumerate features.

## Steps

1. Read the operator request.
2. State the objective in one or two sentences: the technical approach or
   design being tested, not the feature that would eventually ship.
3. Write the technical questions the spike must answer. Each one must be
   decidable by looking at a running result, not by argument. Give each one a
   stable id of the form `TQ-01`, `TQ-02`, and write the entry as
   `{ "id": "TQ-01", "question": "..." }`. Every later stage names a question
   by that id and never by its text.
4. For each question, name at least one observable success signal — something
   the spike will produce that shows the answer.
5. List the shortcuts that are acceptable in advance: what the spike may stub,
   fake, hard-code, or skip. Naming these up front is what keeps the spike fast.
6. List what is out of scope, especially production concerns the operator does
   not want spent on: migrations, hardening, breadth of error handling,
   performance work, accessibility passes, and release readiness.
7. Surface open questions you could not resolve from the request rather than
   deciding them yourself.

## Output

Populate `data.prototype_brief` (`objective`, `technical_questions`,
`success_signals`, `acceptable_shortcuts`, `out_of_scope`). Each
`technical_questions` entry MUST be an object with a non-empty `id` and
`question` (`PROTO-001`); the harness rejects a bare string, because the evaluator has no
other way to learn the identifier it must answer. When
`output.operator_brief` exists, edit its declared source and reference the
rendered HTML. Do not run the renderer. When the contract omits
`output.operator_brief`, do not create either brief file.

## Done when

Each technical question has an observable signal, the shortcuts the spike may
take are stated rather than implied, and nothing material has been invented
beyond the operator request.
