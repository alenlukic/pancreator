# Operator section
- 👀 **In this file:** Pipeline State Contract
- ⚖️ **Why it matters:** Defines pipeline state-machine authoring, stage ownership, gate validation, and remediation routing.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/output-manifest-contract.md
---
pancreator-section-index:
  format: operator-agent-v1
  agent_section_start_line: 8
title: Pipeline State Contract
slug: pipeline-state-contract
stability: experimental
bootstrap-only: false
phase: 0b
owners: [supervisor, tech-lead]
purpose: Defines pipeline state-machine authoring, stage ownership, gate validation, and remediation routing.
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/output-manifest-contract.md
  - /lib/pipelines/feature-delivery.yaml
---

# Pipeline State Contract

A pipeline definition is the state-machine source of truth. Agents MUST NOT infer
stage ownership, required docs, definitions of done, or remediation routes from
conversation context when the pipeline declares them.

## Required stage contract fields

Every pipeline stage SHOULD declare a `contract` object with:

```yaml
contract:
  key: PIPE.<PIPELINE>.<STAGE>
  persona_contract: PERSONA.<OWNER>
  required_docs: [DOC.AGENTS, DOC.REGISTRY, DOC.OUTPUT_MANIFEST]
  required_inputs: [path-or-logical-input]
  required_outputs: [path-or-logical-output]
  definition_of_done:
    - concrete pass condition
  gate:
    validator: PERSONA.SUPERVISOR | PERSONA.REVIEWER | runtime
    predicate: gate field or transition condition
    pass_event: event_name
    fail_event: event_name
  remediation:
    default_owner: PERSONA.<OWNER>
    plan_invalidating_owner: PERSONA.TECH_LEAD | PERSONA.SUPERVISOR
```

Executor-owned artifacts MAY declare bounded `scope_amendments` when the stage
contract allows auto-amendable path additions. When that lane exists, the
validator MUST compare the current diff against both the planned touch-set and
the recorded amendments before it accepts the pass transition.

## Transition rule

Before a stage transition, the validator MUST check:

1. every required output exists;
2. every output manifest is present and names the expected persona/stage keys;
3. every definition-of-done condition is evidenced;
4. any bounded scope amendment is declared, class-valid, and ratified by the
   owning validator before pass; and
5. the gate predicate is parseable and satisfied for a pass transition; and
6. failures route to the remediation owner named by the stage contract.

When any check fails, the pipeline MUST remain at the current stage or route to
the declared remediation stage. It MUST NOT advance based on broad prose claims.
