---
title: Bulk TBD-on-commit contentHash refresh tool
feature_id: bulk-contenthash-refresh
stage: intake
owner: intake-analyst
status: open
created_at: 2026-05-25T06:05:10Z
references:
  - kind: path
    path: src/memory/features/timestamp-naming-conventions/citation-rot-scan.md
    note: Documents 501 TBD-on-commit placeholders across ADRs, feature specs, and handbook anchors.
  - kind: path
    path: src/memory/features/json-formatting/spec.md
    note: Layer-1 rule forbids TBD-on-commit placeholders in ratified Markdown surfaces.
  - kind: path
    path: src/memory/features/json-formatting/index.json
    note: deferred_backlog_ids names "json-formatting-citation-verifier-prefix" as the dependency for the refresh pass.
  - kind: path
    path: src/internal/tools/canonical-json-format.mjs
    note: abbreviateHashes and resolveAbbrevLen already exist as the canonical formatter; the refresh tool reuses them.
---

# Bulk TBD-on-commit contentHash refresh tool

## Problem

501 known `TBD-on-commit` contentHash placeholders sit across ADRs, feature
specs, handbook anchors, and active-memory references. Layer-1 lint forbids
them on ratified Markdown surfaces, but the volume makes hand-fixing
impractical. The compliance-auditor records this as `m-02` in every broad
sweep with no remediation owner; the librarian backlog has carried the
deferred refresh since the json-formatting delivery report shipped.

## Goal

Ship a deterministic refresh tool that walks a configurable file set,
computes the abbreviated SHA-256 for every dual-anchor citation whose
`contentHash` is `TBD-on-commit` (or stale), and patches the value in
place.

## Required outcomes

1. `node src/internal/tools/refresh-citations.mjs [--dry-run] [<glob>...]`
   walks the repository and patches `contentHash` placeholders.
2. The tool reuses the canonical JSON formatter so emitted JSON matches the
   ratified `json-formatting` spec.
3. The tool handles citations embedded in Markdown (fenced JSON blocks),
   citations in `*.json` files (frontmatter and body), and citations in
   YAML frontmatter (`references:` lists).
4. The tool is idempotent: a second `--dry-run` after a `--write` reports
   zero proposed changes.
5. The tool refuses to touch `src/inbox/notes/` and respects the
   semantic-immutability contract for `src/inbox/{in,out,threads}/`.
6. A node-test suite under `tests/` covers all three citation surfaces.

## Acceptance criteria

- Running the tool with `--write` against `main` resolves at least the
  documented 501 placeholders without modifying any non-citation content.
- The compliance-auditor's `m-02` minor finding closes on the next broad
  sweep.
- The librarian backlog item `bulk-contenthash-refresh` is closed with a
  citation to the refresh-tool delivery report.
- The tool is documented in `src/memory/handbook/contract-format.md`
  alongside the dual-anchor citation contract.

## Out of scope

- Resolving citations whose target file no longer exists (those become
  inbox tickets per the dual-anchor `gone` status).
- Replacing the canonical formatter or its hash abbreviation rules.

## Recommended downstream owners

- `tesseract-engineer` for the implementation and node-test harness.
- `librarian` for the post-merge sweep and backlog closure.
- `compliance-auditor` for the gate-flip from `block` to `pass`.
