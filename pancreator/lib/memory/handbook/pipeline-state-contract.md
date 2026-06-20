---
slug: pipeline-state-contract
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [supervisor, tech-lead]
purpose: "Defines pipeline state-machine authoring, stage ownership, gate validation, and remediation routing."
related:
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/output-manifest-contract.md
  - /lib/pipelines/feature-delivery.yaml
...

# Operator section
- 👀 **In this file:** Pipeline State Contract
- ⚖️ **Why it matters:** Quick orientation for Pipeline State Contract before agents load the full contract.
- 🧭 **See also:**
  - /AGENTS.md
  - /lib/memory/handbook/agent-document-registry.md
  - /lib/memory/handbook/output-manifest-contract.md

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
5. deterministic artifact lint passes (required-doc receipts, consulted-doc
   attestation, produced-artifact path attestation, and verdict/event coherence);
6. when workflow helper artifacts are present, `transition-summaries.jsonl`
   warning/status fields are consistent with `workflow-health.json`; and
7. the gate predicate is parseable and satisfied for a pass transition; and
8. failures route to the remediation owner named by the stage contract.

When any check fails, the pipeline MUST remain at the current stage or route to
the declared remediation stage. It MUST NOT advance based on broad prose claims.

## Planning/execution handoff discipline

When a task requires both planning and execution, the planning agent SHALL
produce a bounded handoff card before execution starts. The handoff card SHALL
live at `.pan/work/<day>/<task-id>/handoff.md` for active runs, the generated
subagent prompt SHALL live at `.pan/work/<day>/<task-id>/next-prompt.md`, and
active memory SHALL store only a pointer in `lib/memory/active/handoffs.md`.

A handoff card SHOULD include the Feature id, current stage, planner persona,
executor persona, upstream artifact paths, in-scope paths, explicit non-goals,
validation commands, known pre-existing failures, and unresolved blockers.

When a parent agent invokes an executor, the parent SHOULD pass the generated
`next-prompt.md` path or its contents as the initial payload. The parent SHALL
pass the operator-supplied task text or generated prompt verbatim and SHALL NOT
paraphrase, summarize, or inject inferred intent, assumptions, or interpretation
into the executor prompt. The parent SHALL NOT paste full PRD sections, handbook
pages, archival artifacts, feature specs, prior chat transcripts, broad directory
listings, or planner scratch notes into the executor prompt unless the generated
prompt names the exact file. This handoff fidelity requirement mirrors the
delegation authority rules in `AGENTS.md` §2.

When an agent runs SDK-mode feature-delivery CLI commands from chat on the
operator's behalf, the agent SHALL relay stderr progress to the operator chat
surface: set `PAN_FD_PROGRESS=ndjson`, watch for `feature_delivery_progress`
events, and post concise status on each `stage_enter`, `stage_transition`,
`heartbeat`, and `stage_complete` before the command finishes. See `AGENTS.md`
§5. Operators in a TTY receive `[pan fd] …` on stderr automatically; see
`OPERATION.md` § SDK mode.

When execution finds ambiguity that changes acceptance criteria, validation
strategy, or broad feature scope, the executor SHALL stop and delegate back to
`tech-lead`, `reviewer`, or `supervisor` rather than extending a local repair
loop.

When execution needs one low-risk path that is obviously implied by an existing
touch-set entry, the executor MAY record a bounded scope amendment instead of
halting immediately. Auto-amendable examples include a co-located test,
snapshot, or fixture for an already-declared source file, or a sibling file
inside an already-declared directory when a declared symbol change requires it.

When an executor records a bounded scope amendment, the executor SHALL update
the run's `touch-set.json`, SHALL echo the same amendment in the stage output
manifest, and SHALL present the amendment for owner ratification at the next
gate.

When execution needs a new top-level directory, a new package, a production
dependency, a public API surface, or any file under a change-controlled
governance tree, the executor MUST NOT self-amend the scope and MUST delegate
upstream.

When a reviewer sends work back to implementation, the reviewer SHALL emit a
compact must-fix list and the supervisor SHALL choose one bounded re-entry
target. The supervisor SHOULD NOT ask the same executor to repeatedly re-read
broad context after equivalent failures.
