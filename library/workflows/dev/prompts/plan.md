## Objective

Produce an implementation-ready engineering plan and explicit acceptance
criteria from the ratified product specification.

## Steps

1. Read the ratified product spec referenced by the card.
2. Dispose of every open question the spec carries. Answer a question only from
   evidence you actually read, and cite it. When a question asks what a prior
   change removed, added, or previously guaranteed, read that change's own
   history — its commit, diff, or pull request — because the current workspace
   cannot show what a change deleted. Present code is not evidence about the
   past.
3. When evidence does not settle a question, defer it with the decision named
   for implementation, or escalate it for an operator decision. Do not answer it
   by assumption, and do not turn an assumed answer into an acceptance
   criterion. When the card's operator-involvement section shows the spec was
   ratified without the operator, no question reached a human: escalate rather
   than assume whenever the answer would change ratified scope, add a capability
   the request did not name, or decide a product question.
4. Choose the smallest coherent architecture that satisfies the spec.
5. Name the approach, components, likely files, dependencies, risks, migration
   concerns, and validation methods.
6. Write acceptance criteria and map each one back to a user story or
   requirement and forward to a verification method.

## Output

Populate `data.engineering_plan` (`approach`, `components`, `files`, `risks`,
`validation`), `data.acceptance_criteria`, and `data.open_question_dispositions`.
Each disposition states the question `id`, a `disposition` of `resolved`,
`deferred`, or `escalated`, an `answer` naming the answer or the decision still
required, and `evidence`, which is required and must be non-empty for a resolved
question. Author the plan at the declared brief source path. Do not run the
renderer. Reference the rendered HTML as the narrative artifact.

Do not copy the intake product spec into your output; the harness reads it from
the intake record. If the change warrants a different verification level than
the card shows, you MAY set `data.verification_recommendation` to
`{ "level": <name>, "reason": <why> }`. The operator decides; do not assume
the change.

## Done when

Every open question has a recorded disposition whose resolutions rest on cited
evidence, every requirement maps to a testable acceptance criterion, no
criterion asserts a deferred or escalated answer, the plan needs no further
architectural decisions, and it minimizes new structure.
