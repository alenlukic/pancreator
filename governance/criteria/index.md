# Criteria catalog

The terms **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** in this document use RFC 2119 and RFC 8174 meanings.

This catalog defines the shared vocabulary for workflow-stage criteria. Each stage MUST declare its own `criteria[]` inline under `library/workflows/<workflow>/stages/`. This catalog is documentation and MUST NOT be loaded as a runtime contract unless an invocation references it.

## Criterion contract

Each criterion MUST represent one independently checkable claim and MUST define:

- `id`: a stable, namespaced identifier in `<area>.<claim>` form.
- `type`: `judgment`, `shell`, or `state`.
- `statement`: a claim phrased so that pass and failure are unambiguous.
- `hard`: a boolean when failure MUST block the stage. Omitted or `false` means advisory.

A reasoning agent MUST evaluate a `judgment` criterion. A `shell` criterion MUST be rerun by the harness, and a worker self-claim MUST NOT substitute for command evidence. The harness MUST evaluate a `state` criterion against durable run state or workspace fingerprints.

A stage MUST NOT succeed unless its output shape is valid and every declared criterion has a self-evaluation. The stage also MUST NOT succeed unless every hard criterion passes, its workspace mutation policy is satisfied, and every hard deterministic check passes.

## Naming and stability

- An author MUST namespace criterion identifiers by responsibility, such as `record.*`, `scope.*`, `intake.*`, `plan.*`, `implement.*`, `review.*`, `test.*`, `ship.*`, or `preflight.*`.
- A criterion MUST contain one claim. Independently checkable claims joined by “and” SHOULD be split.
- Criterion identifiers MUST remain stable after evidence references them. A breaking rename MUST include an explicit migration strategy.

## Reusable criterion families

- `record.operator_readable` MUST require a concise outcome, blockers, evidence pointers, and next action.
- `record.simplified_english` MUST require that an artifact an operator reads obeys `STE-001`. The deterministic check covers only the countable rules. Thus this criterion MUST be a `judgment` criterion that evaluates terminology consistency, noun-group length, active voice, one topic per paragraph, and risk-notice correctness.
- `scope.no_unapproved_changes` is an external-contamination detector, not a punishment for worker-attributable edits. The harness MUST inject it for any stage whose `workspace_policy` is not `source_allowed`. It MUST pass when every changed blocking path is explicitly traced to the active worker. It MUST fail only for external, mixed, unknown, or unattributed changes. `release_metadata_only` continues to identify expected self-development release paths separately.
- `scope.no_unapproved_changes` MUST treat a tracked change in the harness root as contamination when the run works in another directory. This criterion carries no exception for a release landing. A worker declaration attributes only the run's own workspace. Thus the operator MUST land a self-development release on the harness root's local default branch after submit, rather than except that landing here. The ship contract owns that sequencing, and a ship stage that follows it presents no harness-root delta. A harness-root delta that is not that landing MUST still fail and MUST name the paths.
- `*.acceptance_met` MUST require independently verifiable acceptance evidence rather than an unsupported completion claim.
- `*.tests_correct` MUST require meaningful tests that are correctly scoped and resistant to false positives.
- `*.maintainable` MUST require structural and maintenance risk proportionate to the requested scope.
- Repository verification criteria MUST call configured repository-check profiles. Coverage MAY be part of a profile only when the target repository explicitly defines a coverage command. Pancreator MUST NOT invent a standalone coverage gate.

## Deterministic-first selection

A criterion that a command or durable state can check MUST use `shell` or `state`. A criterion MAY use `judgment` only when it requires semantic reasoning, such as faithfulness, proportionality, or maintainability. Hard judgment criteria SHOULD pass through an independent gate rather than worker self-certification alone.
