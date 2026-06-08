---
title: "FD pipeline SDK mode — retry model escalation tiers"
feature_id: fd-pipeline-sdk-mode-retry-model-escalation-tiers
status: intake-awaiting-ratification
next_owner: tech-lead
next_stage: plan
source_inbox_item: lib/inbox/in/172973_06-02-26/24815_1706_fd-pipeline-sdk-model-escalation-tiers.md
intake_round: 0
references:
  - kind: lines
    path: lib/inbox/in/172973_06-02-26/24815_1706_fd-pipeline-sdk-model-escalation-tiers.md
    range: [43, 173]
    contentHash: fd765d7
    note: "Source directive — problem statement, goal, required outcomes R1–R7, and acceptance criteria."
  - kind: lines
    path: pancreator.yaml
    range: [28, 35]
    contentHash: a7092be
    note: "Live runner.cursor.invocation sdk block and stage_remediation flag — escalation tiers apply only when sdk mode is active."
  - kind: lines
    path: lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts
    range: [45, 56]
    contentHash: c0befcf
    note: "FeatureDeliveryAutomationState interface and FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET constant — this Feature adds stageInvocationIndex to the interface."
  - kind: lines
    path: lib/internal/packages/@pancreator/runner-cursor/src/sdk-model.ts
    range: [1, 15]
    contentHash: 172ab7a
    note: "resolveSdkModelId strips bracket qualifiers for the SDK call — escalation config stores full strings; stripping continues for the @cursor/sdk call only."
  - kind: lines
    path: lib/internal/packages/@pancreator/runner-cursor/src/sdk-transport.ts
    range: [72, 100]
    contentHash: 82c59fb
    note: "createDefaultCursorSdkTransport resolves persona.model once per invocation — this Feature requires a model-override parameter at invoke time."
  - kind: lines
    path: lib/pipelines/feature-delivery.yaml
    range: [25, 66]
    contentHash: 3c558e1
    note: "Canonical stage-to-persona map — escalation tier entries are keyed by persona slug, not stage id."
  - kind: lines
    path: OPERATION.md
    range: [109, 126]
    contentHash: a91d661
    note: "SDK mode operator loop documentation — this Feature adds escalation subsections to the SDK mode section."
---

# Spec

This Feature SHALL extend the feature-delivery SDK runner with a YAML-driven model escalation tier system. When `runner.cursor.invocation` is `sdk`, each `CursorRunner.invoke` call SHALL select the persona's effective model from a named escalation config keyed by a per-stage invocation index. When the selected model is unavailable, the runner SHALL traverse a defined fallback chain. When a stage succeeds or the cumulative retry budget is exhausted, the runner SHALL reset all per-stage escalation state to defaults. Every escalation decision and fallback event SHALL be recorded in `run.log.jsonl`. Manual-mode behavior, the cumulative retry budget constant, persona markdown files, and non-feature-delivery pipelines are unchanged.

## Background

### Current state

`CursorRunner.invoke` calls `createDefaultCursorSdkTransport`, which resolves `persona.model` exactly once per invocation from the persona record (`sdk-transport.ts` lines 72–100). No escalation logic exists: the same model string applies on every automatic loopback (`must_fix`, `qa_fails`, or stage remediation retry). `resolveSdkModelId` strips bracket qualifiers from the stored model string before passing the bare id to `@cursor/sdk` (`sdk-model.ts` lines 1–15). `FeatureDeliveryAutomationState` tracks `cumulativeRetryCount` and `stageRemediationCount` but carries no per-stage invocation index (`feature-delivery-runner.ts` lines 45–51). No declarative configuration surface exists for escalation, and operators cannot change the model used on a retry without modifying source.

### New domain terms

The following terms are introduced by this Feature. The implementation change SHALL add each term to `lib/memory/handbook/glossary.md`.

- **escalation config** — a named entry under the top-level `configs` key of `pancreator-model-escalation.yaml`; each escalation config contains a per-persona tier map.
- **escalation tier** — one entry in an escalation config's persona tier map; keyed by the literal string `default` or by a non-negative integer; its value is a model string.
- **tier key** — the integer key of an escalation tier entry; the effective model for stage invocation index N is the tier whose tier key is the greatest integer ≤ N; when no integer tier key applies, the `default` tier value is used.
- **effective model** — the model string resolved from the active escalation config for a given persona slug and stage invocation index; it overrides the static persona frontmatter model for one SDK transport invocation.
- **stage invocation index** — a non-negative integer equal to the number of times the current stage has been invoked in the current run; 0 on the first invocation of each stage; incremented by 1 on each loopback to the same stage; reset to 0 on first entry to any new stage.
- **model issue** — a transport-classified failure where `@cursor/sdk` returns an error caused by an unresolvable model name, a provider-unavailable response, or a model quota error; distinct from artifact-missing errors and stage-logic errors.
- **active config** — the escalation config name selected for the current run; resolved from the `runner.cursor.model_escalation.config` key in `pancreator.yaml`, or overridden by the `PAN_MODEL_ESCALATION_CONFIG` environment variable.

## Scope and non-scope orientation

| Concern | Authoritative source | Spec posture |
|---|---|---|
| Stage inventory and persona ownership | `lib/pipelines/feature-delivery.yaml` lines 25–66 | Reference only; no stage or persona ownership edits in this Feature. |
| CursorRunner.invoke base contract | `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md` | This Feature extends the base contract; non-escalation behavior remains authoritative there. |
| Cumulative retry budget constant | `lib/internal/packages/@pancreator/cli/src/feature-delivery-runner.ts` line 56 | Reference only; the value of `FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET` is unchanged unless tier-key alignment requires an update, documented separately. |
| Manual-mode operator loop | `OPERATION.md` lines 109–126 | Reference only; manual mode receives no escalation behavior. |
| bracket qualifier stripping for `@cursor/sdk` | `lib/internal/packages/@pancreator/runner-cursor/src/sdk-model.ts` lines 1–15 | Reference only; stripping continues for the SDK call; full strings are preserved in logs and config. |

## Acceptance criteria

The acceptance criteria split into nine work packages. The plan-stage executor MAY ratify alternative work-package partitioning, but every clause SHALL be satisfied before the implementation report is accepted.

### WP-1 — Escalation config schema and canonical file

- The repository SHALL ship one canonical escalation config file at `pancreator-model-escalation.yaml` in the repository root.
- The file SHALL contain a top-level `active_config` scalar whose value is a key present in the `configs` map.
- The file SHALL contain a top-level `configs` map; each key is a config name string; each value is an object with a `personas` map.
- Each entry in `personas` SHALL be keyed by a persona slug that matches a file under `lib/personas/<slug>.md`.
- Each persona entry SHALL contain a `default` key whose value is a model string.
- Each persona entry MAY contain integer keys; each integer key's value SHALL be a model string.
- Model strings in the config SHALL be stored verbatim, including bracket qualifiers (for example `composer-2.5[fast=false]`).
- The shipped file SHALL include at minimum a `default` config with `coder` and `reviewer` persona entries matching the illustrative example in the source directive (`lib/inbox/in/172973_06-02-26/24815_1706_fd-pipeline-sdk-model-escalation-tiers.md` lines 67–82).
- The repository SHALL ship a JSON Schema file at `tests/compliance/schemas/model-escalation-config.schema.json` that expresses the required structure above.

### WP-2 — Config loader, validation, and active config selection

- When `CursorRunner` initialises under SDK mode, the loader SHALL read `pancreator-model-escalation.yaml` from the repository root before the first `invoke` call.
- When the file is absent, the loader SHALL throw a typed `ModelEscalationConfigError` with an actionable message naming the expected file path.
- When the file fails YAML parsing, the loader SHALL throw `ModelEscalationConfigError` with the parse error detail.
- When the file fails validation against `model-escalation-config.schema.json`, the loader SHALL throw `ModelEscalationConfigError` naming the failing path and value.
- When the `active_config` value names a key absent from `configs`, the loader SHALL throw `ModelEscalationConfigError` naming the missing key and the list of available keys.
- When `pancreator.yaml` contains `runner.cursor.model_escalation.config: <name>`, the loader SHALL use `<name>` as the active config name in place of the file-level `active_config` scalar.
- When the environment variable `PAN_MODEL_ESCALATION_CONFIG` is set, its value SHALL override both `pancreator.yaml` and the file-level `active_config` scalar.
- When `runner.cursor.invocation` is `manual`, the loader SHALL NOT execute and escalation logic SHALL NOT run.

### WP-3 — Stage invocation index tracking

- The `FeatureDeliveryAutomationState` interface SHALL gain an integer field `stageInvocationIndex` with default value 0.
- When the runner enters a stage for the first time in a run, the runner SHALL write `stageInvocationIndex: 0` to `state.json` before invoking the SDK transport.
- When the runner re-enters the same stage after a loopback event (`must_fix` or `qa_fails`), the runner SHALL increment `stageInvocationIndex` by 1 in `state.json` before the next SDK transport invocation.
- When the runner transitions to a different stage, the runner SHALL reset `stageInvocationIndex` to 0 in `state.json` before invoking the SDK transport for that stage.

### WP-4 — Tier resolution in CursorRunner

- When `runner.cursor.invocation` is `sdk`, `CursorRunner.invoke` SHALL call the tier resolver with the entering persona slug and the current `stageInvocationIndex` before constructing the transport call.
- When the persona slug is absent from the active config's `personas` map, the tier resolver SHALL return the string `auto` and SHALL append one `WARN`-severity record to `run.log.jsonl` naming the persona slug and active config name.
- When the persona slug is present in the active config's `personas` map, the tier resolver SHALL return the model string from the tier entry whose integer key is the greatest value ≤ `stageInvocationIndex`; when no integer key is ≤ `stageInvocationIndex`, the resolver SHALL return the `default` tier value.
- `CursorRunner.invoke` SHALL pass the resolved effective model string to `createDefaultCursorSdkTransport` as an override that supersedes the static `persona.model` field for that invocation only.
- `resolveSdkModelId` SHALL strip bracket qualifiers from the effective model string before the `@cursor/sdk` call.
- The full effective model string including bracket qualifiers SHALL be preserved in the run log record for that invocation.

### WP-5 — Model-issue fallback chain

- When `createDefaultCursorSdkTransport` returns `status: "error"` and the error is classified as a model issue, `CursorRunner.invoke` SHALL attempt the fallback chain before returning failure.
- The fallback chain SHALL execute in this order: (1) each tier entry whose integer key is less than `stageInvocationIndex`, traversed in descending key order; (2) the `default` tier value, when not already attempted; (3) each tier entry whose integer key is greater than `stageInvocationIndex`, traversed in ascending key order; (4) the string `auto`.
- When a fallback transport call succeeds, `CursorRunner.invoke` SHALL return that result and SHALL append one `INFO`-severity record to `run.log.jsonl` with fields `escalation.fallback_reason`, `escalation.attempted_model`, `escalation.fallback_model`, and `escalation.outcome: "success"`.
- When a fallback transport call also returns a model-issue error, `CursorRunner.invoke` SHALL continue to the next model in the fallback chain.
- When every fallback model including `auto` returns a model-issue error, `CursorRunner.invoke` SHALL return `status: "error"` and SHALL append one `ERROR`-severity record to `run.log.jsonl` with field `escalation.outcome: "chain_exhausted"` and a list of all attempted model strings.
- When the transport returns a non-model-issue error, `CursorRunner.invoke` SHALL return that error immediately without attempting any fallback.
- The model-issue classifier SHALL be a pure function that accepts a `CursorSdkInvokeResult` and returns a boolean. The tech-lead SHALL document the exact error-message patterns the classifier matches in the plan-stage ADR.

### WP-6 — Reset on stage success and retry-limit halt

- When a stage invocation completes with `status: "ok"` and all required artifacts are present, the runner SHALL write `stageInvocationIndex: 0` to `state.json` before advancing to the next stage.
- When `cumulativeRetryCount` exceeds `FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET`, the runner SHALL write `stageInvocationIndex: 0` to `state.json` before entering the `halted` terminal state.
- Reset SHALL NOT require operator intervention.
- When no escalation is in progress, `state.json` SHALL NOT carry an `escalation` snapshot field.

### WP-7 — Run-log observability

- Each `CursorRunner.invoke` call under SDK mode SHALL append one record to `run.log.jsonl` containing the fields `escalation.active_config`, `escalation.persona_slug`, `escalation.stage_invocation_index`, `escalation.resolved_model`, and `escalation.full_model_string`.
- When a fallback attempt occurs, the runner SHALL append one additional `run.log.jsonl` record per fallback attempt, containing the fields `escalation.fallback_model`, `escalation.fallback_reason`, and `escalation.outcome`.
- All escalation observability fields SHALL be nested under the `escalation` key in each run log record.

### WP-8 — OPERATION.md and glossary documentation

- When this Feature ships, the "SDK mode" subsection of `OPERATION.md` SHALL document: the location of `pancreator-model-escalation.yaml`; the schema summary; the active config parameter `runner.cursor.model_escalation.config` and the `PAN_MODEL_ESCALATION_CONFIG` environment variable override; the stage invocation index semantics and tier resolution gap rule; the model-issue fallback order (down-chain, default, up-chain, `auto`); reset triggers; and the `run.log.jsonl` field names for escalation observability.
- The implementation change SHALL add the seven new domain terms defined in the "New domain terms" section above to `lib/memory/handbook/glossary.md`.

### WP-9 — Unit tests and compliance fixture

- When `pnpm --filter @pancreator/runner-cursor test` runs, the test suite SHALL include cases for: tier resolution at `stageInvocationIndex` 0 (default returned), at index 1 with a gap key above 1 (default returned), at index 3 with an exact key (keyed model returned), and at index 5 beyond all defined keys (highest key's model returned).
- When `pnpm --filter @pancreator/runner-cursor test` runs, the test suite SHALL include cases for the fallback chain order when the first attempt returns a model issue.
- When `pnpm --filter @pancreator/runner-cursor test` runs, the test suite SHALL include a case asserting that `stageInvocationIndex` resets to 0 after a successful stage invocation.
- When `pnpm --filter @pancreator/runner-cursor test` runs, the test suite SHALL include a case asserting that the `PAN_MODEL_ESCALATION_CONFIG` environment variable overrides the `pancreator.yaml` key.
- When `pnpm --filter @pancreator/cli test` runs, the test suite SHALL include a case asserting that `advanceFeatureDelivery` under SDK mode uses the escalated model on the second loopback to the same stage, against a mock transport.
- When `node --test tests/*.test.mjs` runs, the repository-level test suite SHALL remain green.
- When `node lib/internal/tools/check-phase-0a-scaffold.mjs` runs, the scaffold-conformance suite SHALL remain green.
- The compliance test suite at `tests/compliance/` SHALL include a fixture that validates `pancreator-model-escalation.yaml` against `tests/compliance/schemas/model-escalation-config.schema.json`.

## Documentation impact

```yaml
documentation_impact:
  applies: true
  rationale: >-
    This Feature introduces a new config file, a new loader module, new state fields,
    new run-log observability fields, and a fallback chain. OPERATION.md requires an
    escalation subsection. The glossary requires seven new term entries. The compliance
    schema directory gains one new schema file. pancreator-config.md requires a note
    on the runner.cursor.model_escalation.config key.
  changed-surfaces:
    - pancreator-model-escalation.yaml (new file at repo root)
    - OPERATION.md (SDK mode subsection additions)
    - lib/memory/handbook/glossary.md (seven new terms)
    - lib/memory/handbook/pancreator-config.md (runner.cursor.model_escalation.config key)
    - tests/compliance/schemas/model-escalation-config.schema.json (new file)
  deferred-items: []
```

The plan-stage executor SHALL refine `changed-surfaces` against the realised touch-set and SHALL add backlog entries under `deferred-items` for any surface that cannot be updated within this task boundary.

## Out of scope

- Changing the value of `FEATURE_DELIVERY_AUTO_ADVANCE_RETRY_BUDGET`; any required change SHALL be tracked as a separate task.
- Editing persona markdown files under `lib/personas/` or Cursor agent projections under `.cursor/agents/`, except where spec clauses require documenting the escalation override relationship.
- Cloud-runtime model availability guarantees beyond what `@cursor/sdk` exposes to the runner.
- Escalation for non-feature-delivery pipelines; the config loader MAY be reused by future features without spec changes to this Feature.
- Phoenix trace, Langfuse, or cost-telemetry dashboards; observability scope is limited to `run.log.jsonl` fields for this Feature.
- Changing manual-mode behavior; when `runner.cursor.invocation` is `manual` or omitted, the runner SHALL behave identically to today.

## Suggested downstream owners

| Concern | Recommended owner |
|---|---|
| Plan, ADR draft, and touch-set | `tech-lead` |
| Config schema, loader, `ModelEscalationConfigError`, and JSON Schema fixture | `pancreator-engineer` |
| Tier resolver, `stageInvocationIndex` state tracking, and CursorRunner changes | `pancreator-engineer` |
| Model-issue classifier taxonomy, fallback chain, and transport override | `pancreator-engineer` |
| Unit tests and compliance test fixture | `pancreator-engineer` |
| Touch-set, disallowed-tool, and contracts review | `reviewer` |
| Manual QA and quality-gate validation | `qa-tester` |
| OPERATION.md and glossary documentation | `tech-writer` |
| Delivery report and ship staging | `supervisor` |
| Index, artifact closure, and active-memory hygiene | `librarian` |

## Traceability

- Source directive: `lib/inbox/in/172973_06-02-26/24815_1706_fd-pipeline-sdk-model-escalation-tiers.md`.
- Upstream Feature: `lib/memory/features/feature-delivery-harness-wire-cursorrunner-through-run-and-advance/spec.md` (defines the `CursorRunner.invoke` base contract that this Feature extends with escalation).
- Active task: `24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers` under `.pan/work/172973_06-02-26/`.

## Open questions

_(none — the directive is sufficiently specified for plan-stage delegation; the model-issue classifier error-message taxonomy and the exact `stageInvocationIndex` field placement are reserved for tech-lead plan-stage ratification per WP-5 and WP-3.)_

## Next operator steps

1. **What:** Review the canonical Engineering Spec and confirm it is acceptable for plan-stage delegation.
   **How:** Read-only: open `lib/memory/features/fd-pipeline-sdk-mode-retry-model-escalation-tiers/spec.md` and verify the nine work-package acceptance blocks, the documentation-impact record, and the empty `## Open questions` section reflect the source directive at `lib/inbox/in/172973_06-02-26/24815_1706_fd-pipeline-sdk-model-escalation-tiers.md`.

2. **What:** Advance the feature-delivery run from `intake` to `plan` once the spec is ratified.
   **How:** From the repository root run:

   ```bash
   pnpm -w exec pan advance 24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers \
     --artifact lib/memory/features/fd-pipeline-sdk-mode-retry-model-escalation-tiers/spec.md
   ```

   Then confirm `.pan/work/172973_06-02-26/24065_1718_fd-pipeline-sdk-mode-retry-model-escalation-tiers/state.json` shows `currentStage: plan` before delegating `tech-lead`.
