---
title: Run-Log Schema Contract
slug: run-log-schema
stability: experimental
bootstrap-only: false
phase: 0b
owners: [tech-lead, librarian, supervisor]
purpose: |
  Canonical schema and behavior contract for run-log emission under
  `/src/work/<day>/<id>/run.log.jsonl`. This file defines the OpenInference + OpenTelemetry
  GenAI-aligned record shape, identity and correlation fields, outcome
  conventions, integrity constraints, and validation checklist that
  `@tesseract/run-logger` SHALL implement in a later phase.
references:
  - kind: lines
    path: BOOTSTRAP.md
    range: [75, 76]
    contentHash: 87ba148945f68978219584d390d21685817468b62879f5397f299275cf43136b
    note: "Phase 0b requires `/src/memory/handbook/run-log-schema.md` as the run-logger contract seed."
  - kind: lines
    path: BOOTSTRAP.md
    range: [181, 183]
    contentHash: e32bcd21ec6b952739869a30836277ef92af167aa0b32bdbdc0da0a3d53a03f0
    note: "Bootstrap observability requirement sets OpenInference + OTel GenAI conformance expectation."
  - kind: lines
    path: PRD.md
    range: [838, 840]
    contentHash: 9ac3ed1d5e8a62d8e57e611b31f25246bb7a24581ce760ccb18ed285c64c5348
    note: "PRD defines run-log path, semantic-convention fields, and checkpoint linkage through run-log offset."
  - kind: lines
    path: PRD.md
    range: [1080, 1084]
    contentHash: 39fb71b647d0f60d5adf5eaa9fd55f11a2ea6549a32bc9443d18517395b2b004
    note: "PRD requires OTLP/OpenInference + OTel GenAI compatible spans and JSONL local sink."
  - kind: lines
    path: PRD.md
    range: [1088, 1088]
    contentHash: 566895748e897dc7893dc315be63ce4c8a9f58cd2abc964785d04fee37229467
    note: "PRD requires stage-boundary checkpoints and LangGraph-compatible saver shape."
related:
  - /PRD.md
  - /BOOTSTRAP.md
  - /src/memory/handbook/glossary.md
  - /src/memory/handbook/contract-format.md
---

# Run-Log Schema Contract

## 1 - Purpose and scope

This file defines the canonical run-log contract for Tesseract pipelines.

During the current bootstrap state, the runtime is not wired in this repo.
Therefore, this document is a design-time contract that future runtime
implementations MUST satisfy. It does not claim current emission behavior.

The contract scope covers:

1. Canonical run-log location and file shape.
2. Required record fields and minimum OpenInference + OTel GenAI alignment.
3. Identity and correlation fields required for replay and postmortem.
4. Integrity, ordering, and redaction expectations.
5. Validation checks and future enforcement milestones.

## 2 - Canonical path and checkpoint relation

The local default run-log sink SHALL be:

- `/src/work/<day>/<task-id>/run.log.jsonl`

The file SHALL use JSON Lines (`.jsonl`) encoding where each line is one record.

At each stage boundary, the checkpointer SHALL persist
`metadata.run_log_offset` in `/src/memory/checkpoints/<task-id>/<seq>.json`.
`metadata.run_log_offset` SHALL point at the byte offset or monotonic record
index immediately after the last committed run-log record for that checkpoint.

When rollback or snapshot occurs, replay tooling SHALL use
`metadata.run_log_offset` + checkpoint sequence to locate the corresponding
run-log prefix deterministically.

## 3 - Record model and required fields

Each JSONL line SHALL represent one span-like event record with the required
top-level fields below:

- `ts` (string, REQUIRED): RFC 3339 UTC timestamp with millisecond precision.
- `trace_id` (string, REQUIRED): 16-byte or 32-hex trace identifier.
- `span_id` (string, REQUIRED): 8-byte or 16-hex span identifier.
- `parent_span_id` (string, OPTIONAL): parent span identifier for rootless links.
- `name` (string, REQUIRED): concise operation name.
- `kind` (string, REQUIRED): logical record category (`span` or `event`).
- `status` (object, REQUIRED): outcome object as defined in Section 5.
- `attributes` (object, REQUIRED): key/value map for semantic-convention fields.
- `resource` (object, REQUIRED): emitter metadata (`service.name`, version, etc.).
- `tesseract` (object, REQUIRED): identity/correlation extension fields.

Records SHOULD remain flat enough for grep and jq workflows. Nested objects
MAY appear in `attributes` for message payload fidelity where semconv expects
structured data.

## 4 - Minimum OpenInference + OTel alignment

Every record SHALL include the following minimum attributes when applicable to
the operation type:

- `openinference.span.kind` (REQUIRED) with one of:
  `LLM`, `AGENT`, `TOOL`, `RETRIEVER`, `RERANKER`, `EMBEDDING`, `GUARDRAIL`,
  `EVALUATOR`, `CHAIN`, `PROMPT`.
- `input.value` (REQUIRED when operation has primary input).
- `output.value` (REQUIRED when operation has primary output).
- `tool.name`, `tool.parameters`, `tool.result` (REQUIRED for tool operations).
- `llm.input_messages` / `llm.output_messages` (REQUIRED for LLM operations).
- `gen_ai.operation.name` (REQUIRED for GenAI operations).
- `gen_ai.provider.name` (REQUIRED for GenAI operations).
- `gen_ai.request.model` (REQUIRED for GenAI operations).
- `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`
  (REQUIRED when token accounting is available; otherwise set explicit null and
  emit `tesseract.token_usage_unavailable: true`).

Future runtime adapters MAY emit additional semconv fields. They MUST NOT
rename or repurpose the required fields above.

## 5 - Status and outcome conventions

Each record SHALL include:

- `status.code` (REQUIRED): one of `OK`, `ERROR`, `CANCELLED`.
- `status.message` (REQUIRED when code is not `OK`): concise failure detail.
- `outcome` (REQUIRED in `tesseract` object): one of
  `success`, `failure`, `aborted`, `quarantined`, `rolled_back`, `skipped`.

Convention rules:

1. If `status.code = OK`, then `tesseract.outcome` SHALL be `success` or
   `skipped`.
2. If `status.code = ERROR`, then `tesseract.outcome` SHALL be `failure` unless
   an intervention changes terminal state (`aborted`, `quarantined`).
3. Intervention records SHALL set `openinference.span.kind = AGENT` and include
   `tesseract.intervention.lever`.

## 6 - Identity and correlation fields

The `tesseract` object SHALL include:

- `task_id` (REQUIRED): pipeline task identifier.
- `pipeline` (REQUIRED): pipeline identifier.
- `stage_id` (REQUIRED): active stage identifier.
- `persona` (REQUIRED when persona-owned execution is active).
- `checkpoint_seq` (REQUIRED at stage boundaries, OPTIONAL otherwise).
- `contract.id` (REQUIRED when a gate/contract is evaluated).
- `tool_call.id` (REQUIRED for tool invocation spans/events).
- `tool_call.parent_turn_id` (REQUIRED when tool call belongs to a persona turn).
- `intervention.lever` (REQUIRED for intervention records).

Correlation requirements:

1. `task_id + trace_id` MUST identify one run lineage.
2. `span_id` MUST be unique within one `trace_id`.
3. Tool-result records MUST reference the initiating `tool_call.id`.
4. Checkpoint records MUST include `checkpoint_seq` and enough metadata to map
   to `/src/memory/checkpoints/<task-id>/<seq>.json`.

## 7 - Integrity, ordering, and redaction

Run-log writers SHALL satisfy all constraints below:

1. **Append-only.** Writers MUST append records; they MUST NOT mutate or delete
   prior lines in normal operation.
2. **Monotonic ordering.** `ts` values SHOULD be non-decreasing per file.
   If clock skew occurs, writers SHALL emit `tesseract.clock_skew: true` and
   preserve append order.
3. **Durability boundary.** A record SHALL be flushed before the corresponding
   checkpoint that references its offset is committed.
4. **Secret handling.** Secrets, credentials, and raw auth tokens MUST NOT be
   emitted in plaintext. Redacted values SHALL use deterministic placeholders
   such as `[REDACTED:<class>]`.
5. **PII minimization.** User-provided content MAY be logged only when required
   for debugging, audit, or replay. Sensitive fields SHOULD be hashed or
   redacted by policy.
6. **Schema stability.** New top-level fields MAY be added, but required fields
   in Sections 3-6 MUST remain backward compatible.

## 8 - Compact JSONL example

```json
{"ts":"2026-04-25T20:30:12.481Z","trace_id":"7c2d0c53df6c4e479fe77e4d821f6a1a","span_id":"1af2d13ed8f74ff9","parent_span_id":"5ba31fbeab9a4f09","name":"tool.call.fs.read","kind":"span","status":{"code":"OK"},"attributes":{"openinference.span.kind":"TOOL","tool.name":"ReadFile","tool.parameters":"{\"path\":\"/src/memory/handbook/run-log-schema.md\"}","tool.result":"ok","gen_ai.operation.name":"tool_call","gen_ai.provider.name":"cursor","gen_ai.request.model":"gpt-5.3-codex","gen_ai.usage.input_tokens":null,"gen_ai.usage.output_tokens":null,"tesseract.token_usage_unavailable":true},"resource":{"service.name":"tesseract","service.version":"0.0.0-bootstrap"},"tesseract":{"task_id":"task-123","pipeline":"bootstrap-phase0","stage_id":"authoring","persona":"tech-writer","tool_call.id":"call-42","tool_call.parent_turn_id":"turn-9","outcome":"success"}}
```

## 9 - Validation checklist

Before a run-log producer is accepted, the implementer SHALL verify:

- [ ] File path is `/src/work/<day>/<task-id>/run.log.jsonl`.
- [ ] Output is valid JSONL with one record per line.
- [ ] Required fields in Sections 3-6 are present and typed correctly.
- [ ] Required OpenInference + OTel fields are emitted when applicable.
- [ ] Status/outcome combinations satisfy Section 5 rules.
- [ ] Checkpoint records align with `metadata.run_log_offset`.
- [ ] Redaction policy prevents plaintext secret leakage.
- [ ] Example run-log imports into Phoenix or Langfuse without adapter code.

## 10 - Future enforcement notes

Enforcement ratchet for this contract:

1. **Phase 0-1 (current).** Manual authoring and review against this checklist.
2. **Phase 2-3.** `@tesseract/run-logger` conformance tests SHALL validate field
   presence, semconv keys, and checkpoint offset linkage.
3. **Phase 3+.** CI SHOULD fail on schema violations for changed run-logger
   code paths and SHOULD emit machine-readable failure reports for triage.

If a required field cannot be emitted in a target backend, the implementation
team SHALL file a backlog item with deferral rationale and migration plan.

## 11 - Stability

This file is a Phase 0b handbook seed and is currently `experimental`.
Promotion to `stable` SHALL follow successful conformance runs of
`@tesseract/run-logger` against this contract and repeated dogfood validation.
