## Objective

Produce an implementation-ready engineering plan and explicit acceptance
criteria from the ratified product specification.

## Steps

1. Read the ratified product spec referenced by the card.
2. Choose the smallest coherent architecture that satisfies it.
3. Name the approach, components, likely files, dependencies, risks, migration
   concerns, and validation methods.
4. Write acceptance criteria and map each one back to a user story or
   requirement and forward to a verification method.

## Output

Populate `data.engineering_plan` (`approach`, `components`, `files`, `risks`,
`validation`) and `data.acceptance_criteria`. Author the plan as the invocation's
schema-valid brief JSON, render it to the exact HTML path from the output
contract, and reference the HTML first and the brief JSON second.

## Done when

Every requirement maps to a testable acceptance criterion, the plan needs no
further architectural decisions, and it minimizes new structure.
