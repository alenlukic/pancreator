# Criteria catalog

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document indicate requirement levels as defined by RFC 2119 and RFC 8174.

This catalog defines the shared vocabulary for workflow-stage criteria. Each stage MUST declare its own `criteria[]` inline under `library/workflows/<workflow>/stages/`. This catalog is documentation and MUST NOT be loaded as a runtime contract unless an invocation references it.

## Criterion contract

Each criterion MUST represent one independently checkable claim and MUST define:

- `id`: a stable, namespaced identifier in `<area>.<claim>` form.
- `type`: `judgment`, `shell`, or `state`.
- `statement`: a claim phrased so that pass and failure are unambiguous.
- `hard`: a boolean when failure MUST block the stage; omitted or `false` means advisory.

A `judgment` criterion MUST be evaluated by a reasoning agent. A `shell` criterion MUST be rerun by the harness, and a worker self-claim MUST NOT substitute for command evidence. A `state` criterion MUST be evaluated by the harness against durable run state or workspace fingerprints.

A stage MUST NOT succeed unless its output shape is valid, every declared criterion has a self-evaluation, every hard criterion passes, its workspace mutation policy is satisfied, and every hard deterministic check passes.

## Naming and stability

- Criterion identifiers MUST be namespaced by responsibility, such as `record.*`, `scope.*`, `intake.*`, `plan.*`, `implement.*`, `review.*`, `test.*`, `ship.*`, or `preflight.*`.
- A criterion MUST contain one claim. Independently checkable claims joined by “and” SHOULD be split.
- Criterion identifiers MUST remain stable after evidence references them. A breaking rename MUST include an explicit migration strategy.

## Reusable criterion families

- `record.operator_readable` MUST require a concise outcome, blockers, evidence pointers, and next action.
- `scope.no_unapproved_changes` MUST require compliance with the declared workspace mutation policy. The harness MUST inject it for any stage whose `workspace_policy` is not `source_allowed`; `release_metadata_only` passes only for bounded self-development release files and behaves as read-only in embedded installations.
- `*.acceptance_met` MUST require independently verifiable acceptance evidence rather than an unsupported completion claim.
- `*.tests_correct` MUST require meaningful tests that are correctly scoped and resistant to false positives.
- `*.maintainable` MUST require structural and maintenance risk proportionate to the requested scope.
- Repository verification criteria MUST call configured repository-check profiles. Coverage MAY be part of a profile only when the target repository explicitly defines a coverage command; Pancreator MUST NOT invent a standalone coverage gate.

## Deterministic-first selection

A criterion that can be checked by a command or durable state MUST use `shell` or `state`. A criterion MAY use `judgment` only when it requires semantic reasoning, such as faithfulness, proportionality, or maintainability. Hard judgment criteria SHOULD pass through an independent gate rather than worker self-certification alone.
