---
slug: output-manifest-contract
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [supervisor, compliance-auditor, tech-writer]
purpose: Defines the output manifest every bounded persona invocation emits and gate validators check.
related:
  - /AGENTS.md
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/memory/handbook/operator-output-contract.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/persona-contracts.md
  - /lib/memory/handbook/pipeline-state-contract.md
...

# Operator section
- 👀 **In this file:** Output Manifest Contract
- ⚖️ **Why it matters:** Quick orientation for Output Manifest Contract before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/operator-agent-artifact-format.md
  - /lib/memory/handbook/operator-output-contract.md

# Output Manifest Contract

An output manifest is the compact, machine-checkable receipt for a persona
invocation. It is not an introspective scratchpad. It records what the static
contract required, what was produced, what validation ran, and whether the
persona's definition of done passed.

## Double-write rule

For bounded work, the persona MUST write the manifest twice:

1. **Artifact copy.** Durable artifacts MUST include `## Output manifest` in the
   artifact's agent section for Markdown or top-level `output_manifest` in the
   agent section for JSON.
2. **Operator copy.** Final chat/stdout MUST include the same manifest summary or
   the path and heading/key where the artifact copy lives, and MUST follow
   `/lib/memory/handbook/operator-output-contract.md`.

The operator section defined by `/lib/memory/handbook/operator-agent-artifact-format.md`
MUST NOT contain the only copy of the manifest. Gate validators ignore operator
sections and validate only agent-section content.

## Markdown shape

```markdown
## Output manifest

- persona_contract: PERSONA.<NAME>
- stage_contract: PIPE.<PIPELINE>.<STAGE> | none
- required_docs: DOC.KEY, DOC.KEY
- consulted_docs: DOC.KEY, DOC.KEY
- produced_artifacts: path, path | none
- scope_amendments: none | path(kind:reason), path(kind:reason)
- validation: command/result, gate/result | none
- definition_of_done: pass | fail | blocked
- gate_decision: advance | remediate | blocked | not_applicable
- remediation_route: PERSONA.<NAME> | human | none
```

## JSON shape

```json
{
  "$operator": "⚙️ no human content",
  "output_manifest": {
    "persona_contract": "PERSONA.NAME",
    "stage_contract": "PIPE.FEATURE_DELIVERY.STAGE",
    "required_docs": ["DOC.AGENTS", "DOC.REGISTRY"],
    "consulted_docs": ["DOC.AGENTS", "DOC.REGISTRY"],
    "produced_artifacts": [".pan/work/<day>/<task-id>/artifact.md"],
    "scope_amendments": [],
    "validation": [{ "name": "gate", "result": "pass" }],
    "definition_of_done": "pass",
    "gate_decision": "advance",
    "remediation_route": "none"
  }
}
```

## Scope amendment rule

`scope_amendments` records bounded path additions an executor made after the
planner emitted the initial touch-set. It is not a waiver for broad scope drift.

Each amendment entry MUST name:

- the repo-relative path the executor added;
- a bounded amendment kind such as `paired-test`, `paired-fixture`, or
  `declared-dir-sibling`; and
- a short reason that ties the path to an already-declared source path, symbol,
  or validation obligation.

An executor MAY record a bounded amendment only when the affected path stays
inside the policy's auto-amendable classes. New packages, new top-level
directories, production dependencies, public API surfaces, and change-controlled
governance trees MUST route to the remediation owner instead of entering
`scope_amendments`.

## Attestation fields

`required_docs` echoes the static set the persona contract declares. `consulted_docs`
is the persona's **attestation** of the `DOC.*`/`PIPE.*` keys it actually resolved
through `DOC.REGISTRY` before acting. The two are distinct on purpose: a manifest
that merely repeats `required_docs` proves nothing, whereas `consulted_docs` is the
checkable claim a gate validates against the contract. Every key in `required_docs`
MUST appear in `consulted_docs`; additional consulted keys are allowed.

`produced_artifacts` is also an attestation. Every path listed there MUST resolve
to a real repository artifact at validation time, and each manifest-bearing
artifact MUST include its own path in `produced_artifacts`. Stale paths are lint
failures, not advisory warnings.

When a stage emits required-doc receipts (`required-doc-receipts/<stage>.json`),
those receipts MUST set `enforce_manifest_consulted_docs: true` and carry
non-empty `required_docs_resolved`, `required_docs_opened`, and
`required_docs_applied` arrays that cover every `DOC.*` key in
`consulted_docs`.

## Gate rule

A transition validator MUST block advancement when the manifest is missing from
the agent section, names the wrong persona contract, omits a required artifact,
declares a passing definition of done without evidence required by the persona
spec, routes remediation to an owner not declared by the pipeline, or when
`consulted_docs` does not cover every key in the contract's `required_docs`.

Validators MUST also reject manifests that omit any shape field shown in
`## Markdown shape` / `## JSON shape`, use file paths in `required_docs` or
`consulted_docs` instead of `DOC.*` / `PIPE.*` / `PERSONA.*` keys, or declare a
stage-specific `stage_contract` / `required_docs` set that does not match the
owning pipeline contract.

For artifact-producing stage transitions, validators MUST run deterministic
artifact lint (`pan artifacts lint <taskId> --stage <stage>`) or an equivalent
runtime-integrated validator path before allowing a clean pass transition.

When a stage validator also checks local diff or touch-set compliance, it MUST
block advancement when a changed path is absent from the declared touch-set and
its recorded `scope_amendments`, or when a recorded amendment falls outside the
policy's auto-amendable classes.
