---
title: Plan Stage Artifact - json-formatting (scope-corrected re-entry)
feature_id: json-formatting
task_id: 67055_0522_json-formatting
stage: plan
status: human-ratified
owner: tech-lead
updated_at: 2026-05-23
next_owner: coder
next_stage: implement
references:
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [40, 53]
    contentHash: 224781e
    note: Scope includes .json files, markdown-embedded JSON, terminal/CLI JSON, and agent-chat JSON.
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [54, 133]
    contentHash: 224781e
    note: Acceptance criteria define canonical shape, hash abbreviation, glossary update, and compliance extension.
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [134, 147]
    contentHash: 224781e
    note: Out-of-scope constraints preserve exclusions and avoid hook/rule enforcement.
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [149, 175]
    contentHash: 224781e
    note: Citation-verifier prefix comparison remains deferred and prior narrowed-scope artifacts are superseded.
  - kind: lines
    path: lib/inbox/threads/json-formatting/round-02-operator-scope-correction.md
    range: [43, 107]
    contentHash: b61efad
    note: Operator ratification confirms all R1 surfaces and corrected enforcement intent.
  - kind: lines
    path: lib/inbox/in/json_formatting.md
    range: [1, 3]
    contentHash: 1d899a0
    note: Source directive requires pretty JSON for output files, terminal/CLI, and agent chat, plus migration.
---

This re-entry plan SHALL replace the superseded narrowed-scope plan set and SHALL implement one canonical JSON writer policy across all ratified surfaces: repository `.json` artifacts, markdown-embedded JSON objects, terminal/CLI JSON output, and agent-chat JSON output. Implementation SHALL remain split into ordered slices so policy and checks land before one-shot rewrite evidence: slice A (`coder`) updates format utilities, output call sites, compliance descriptors, and tests; slice B (`pancreator-engineer`) executes the `.json` bulk migration and captures proof. This plan SHALL NOT reopen deferred verifier logic.

## Implementation Tasks

1. Establish one shared canonical formatter contract in `lib/internal/tools/migrate-json-formatting.mjs` (or extracted helper module under `lib/internal/tools/`) that emits valid JSON with `indent=2`, one object key-value pair per line, and dynamic abbreviation length from `git rev-parse --short HEAD`.
2. Ensure canonical hash abbreviation is applied uniformly for git commit hash fields and `contentHash` fields on all writer surfaces under scope, including markdown citation objects rendered by agent-owned artifact generators.
3. Extend compliance coverage by updating `tests/compliance/json-formatting.yaml` and supporting tests so violations are detectable for both `.json` file outputs and practical non-`.json` surfaces (markdown examples/prose citations plus terminal/chat fixtures where available).
4. Add or revise tests under `tests/` to verify canonical formatter behavior, abbreviation length derivation, markdown-embedded JSON conformance checks, and terminal/chat JSON output formatting checks.
5. Update terminal/CLI JSON emitters in the active runtime paths (including feature-delivery command flows) so printed JSON uses the canonical formatter and never falls back to compact blobs or JavaScript object-literal syntax.
6. Update known agent-facing markdown artifact templates/writers used in this workflow so emitted dual-anchor citation objects serialize in canonical pretty form and never use placeholders for citation hash fields.
7. Update `lib/memory/handbook/glossary.md` entry for `Content hash` / `contentHash` so canonical stored values are abbreviated SHA-256 prefixes whose length equals `git rev-parse --short HEAD` at write time.
8. Execute migration sequence in two slices: slice A lands code/tests/compliance first; slice B runs one-shot `.json` bulk migration in write mode, records rewritten-file counts, and proves idempotency with follow-up dry-run and second-write zero-diff evidence.
9. Preserve non-goals by avoiding pre-commit hook additions, Cursor rule additions, external dependency formatting, and citation-verifier implementation changes (tracked as companion deferred feature).

## Spec Traceability

1. R1 scope surfaces are implemented by tasks 1 through 6.
2. R2 canonical shape rules are implemented by tasks 1, 3, 4, 5, and 6.
3. R3 hash abbreviation rules are implemented by tasks 1, 2, 4, 5, 6, and 7.
4. Glossary acceptance criterion is implemented by task 7.
5. Compliance extension criterion is implemented by tasks 3 and 4.
6. One-shot `.json` migration acceptance criterion is implemented by task 8.
7. Out-of-scope and deferral constraints are enforced by task 9.

## Sequencing Decision

Implementation SHALL proceed in this order:

- Slice A (`coder`): land formatter/output/compliance/test/glossary updates.
- Slice B (`pancreator-engineer`): run bulk `.json` migration and capture evidence.

This order SHALL reduce churn and false negatives by ensuring enforcement logic and assertions exist before repository-wide rewrite evidence is collected.

## Handoff Notes

- Primary executor persona: `coder`.
- Bulk migration executor persona: `pancreator-engineer`.
- Companion deferred feature id: `json-formatting-citation-verifier-prefix`.
- Human ratification gate SHALL occur before any state transition.
