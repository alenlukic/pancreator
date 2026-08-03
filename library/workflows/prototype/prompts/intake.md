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
   decidable by looking at a running result, not by argument.
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
`success_signals`, `acceptable_shortcuts`, `out_of_scope`). Author the brief as
the invocation's schema-valid brief JSON, render it to the exact HTML path from
the output contract, and reference the HTML first and the brief JSON second.

## Done when

Each technical question has an observable signal, the shortcuts the spike may
take are stated rather than implied, and nothing material has been invented
beyond the operator request.
