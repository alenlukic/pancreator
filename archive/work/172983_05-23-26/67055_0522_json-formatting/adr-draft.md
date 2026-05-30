---
title: ADR Draft - Canonical JSON Surfaces and Abbreviated Hash Policy
seq: "draft-json-formatting-0002"
status: human-ratified
date: 2026-05-23
deciders: [tech-lead, LocalUserAuthorizer]
supersedes: draft-json-formatting-0001
superseded-by: null
feature_id: json-formatting
task_id: 67055_0522_json-formatting
references:
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [40, 53]
    contentHash: 224781e
    note: Ratified scope includes repository files, markdown surfaces, terminal/CLI, and agent chat.
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [54, 133]
    contentHash: 224781e
    note: Acceptance criteria define canonical shape, abbreviation policy, glossary update, and compliance extension.
  - kind: lines
    path: lib/memory/features/json-formatting/spec.md
    range: [149, 163]
    contentHash: 224781e
    note: Citation-verifier prefix comparison remains a deferred companion feature.
  - kind: lines
    path: lib/inbox/threads/json-formatting/round-02-operator-scope-correction.md
    range: [43, 101]
    contentHash: b61efad
    note: Operator ratification corrects prior narrowed-scope interpretation and confirms all R1 surfaces.
  - kind: lines
    path: lib/inbox/in/json_formatting.md
    range: [1, 3]
    contentHash: 1d899a0
    note: Source directive states all agent/script JSON output surfaces must be canonicalized and migrated.
---

## Context

The prior plan artifacts were produced against a narrowed scope that applied JSON conformance primarily to `.json` files. The ratified scope-correction thread requires canonical formatting and abbreviation policy on all JSON emission surfaces, including markdown-embedded objects, terminal/CLI output, and agent-chat output.

The feature requires one deterministic formatter shape (`indent=2`, one key per line, pretty-printer default array layout) and one abbreviation rule for git hashes and `contentHash` values where prefix length equals `git rev-parse --short HEAD` at write time.

The feature also requires one glossary alignment for `Content hash` / `contentHash`, while citation-verifier prefix-comparison behavior remains deferred to companion work.

## Decision

When any agent or automated script emits JSON on any in-scope surface, writers SHALL use one canonical formatter contract and SHALL avoid compact single-line object blobs as substitutes for multi-key objects.

When a JSON field represents a git commit hash or a `contentHash`, writers SHALL store and emit the abbreviated prefix length derived from `git rev-parse --short HEAD` at write time across file, markdown, terminal/CLI, and agent-chat surfaces.

When implementation runs, slice A (`coder`) SHALL land formatter call-site alignment, compliance/test extensions, and glossary updates before slice B (`pancreator-engineer`) performs one-shot `.json` bulk migration and records idempotency evidence.

When enforcement is delivered, the project SHALL keep compliance tests as the primary gate and SHALL not add pre-commit hooks or Cursor rule enforcement in this feature.

When citation verification behavior is addressed, the project SHALL route prefix comparison logic to companion feature `json-formatting-citation-verifier-prefix` without expanding this feature scope.

## Status

This ADR is proposed for re-entry plan ratification on 2026-05-23 and supersedes the earlier narrowed-scope draft for the same task.

## Consequences

- Positive: One formatter contract and one abbreviation policy reduce cross-surface drift.
- Positive: Compliance coverage can detect practical violations in non-`.json` surfaces instead of only file artifacts.
- Positive: Ordered slices reduce migration risk by landing checks before mass rewrite execution.
- Negative: Output call-site updates span multiple surfaces and increase implementation complexity versus file-only enforcement.
- Negative: Verifier behavior remains temporarily deferred, so compatibility depends on companion feature delivery.
- Neutral: External dependencies, vendored paths, and tooling-regenerated outputs remain excluded per spec.
