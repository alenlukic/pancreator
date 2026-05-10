---
title: Backlog Index Schema Reference
slug: backlog-format
stability: experimental
bootstrap-only: false
phase: 0b
owners: [tech-lead, librarian]
purpose: |
  The canonical schema for `/src/memory/backlog/index.yaml`, including required
  fields, status and priority enums, and update discipline for open/deferred
  work tracked across bootstrap and milestone execution.
references:
  - kind: lines
    path: src/memory/adr/0001-backlog-tracking.md
    range: [76, 81]
    contentHash: e36b188237d1e2d70aaf96407d1d2c9f852c343c6d4db6c73717ccc9a6fd3775
    note: "ADR decision establishes `/src/memory/backlog/index.yaml` and this handbook schema."
  - kind: lines
    path: AGENTS.md
    range: [77, 83]
    contentHash: eeba7460135f9da011495b32d2656654835855bd1820db9c7a87d83436e9c1a9
    note: "AGENTS requires dual-anchor citations and Layer 1 style discipline."
  - kind: lines
    path: src/memory/handbook/glossary.md
    range: [225, 226]
    contentHash: ed35925aca8483d61b463472090f5859d25844abd5cd4042a5378c83501c73c0
    note: "Glossary defines backlog as the live ranked roadmap."
related:
  - /src/memory/adr/0001-backlog-tracking.md
  - /src/memory/handbook/contract-style.md
  - /src/memory/backlog/index.yaml
---

# Backlog Index Schema

Tesseract SHALL track open, in-flight, deferred, blocked, completed, and
cancelled work items in one canonical file:
`/src/memory/backlog/index.yaml`.

This file defines the required fields and enums for that index. Writers MUST
use this schema when they add or update backlog entries. Reviewers MUST reject
an item that omits a required field or uses an enum value outside this file.

## 1 - Top-level shape

The backlog index MUST be a YAML mapping with:

- `metadata` (required): provenance and schema metadata.
- `items` (required): an array of backlog item mappings.

Recommended `metadata` keys:

- `schema_version` (required): integer schema ratchet.
- `generated_at` (required): ISO-8601 timestamp string in UTC.
- `owners` (required): persona names accountable for backlog hygiene.
- `source_of_truth` (required): canonical path string.

## 2 - Item schema (required fields)

Every item in `items` MUST include:

- `id`: machine-friendly unique identifier (`[a-z0-9-]+`).
- `title`: one-line human-readable title.
- `source`: origin of the item (for example `bootstrap-chat` or a file path).
- `owner`: owning persona name.
- `milestone`: target milestone or phase label.
- `status`: one enum value from the status list in Section 3.
- `priority`: one enum value from the priority list in Section 4.
- `opened_at`: ISO-8601 timestamp string in UTC.
- `links`: array of path or URL strings used as anchors/evidence pointers.
- `evidence`: short rationale describing why the item exists.
- `notes`: short operational notes for handoff and review.

Writers MAY include additional keys, but extra keys MUST NOT replace or weaken
the required fields above.

## 3 - Status enum

`status` is a closed enum:

- `open`
- `in-progress`
- `deferred`
- `blocked`
- `done`
- `cancelled`

Items in `open`, `in-progress`, `deferred`, or `blocked` status SHOULD remain
in the index until they transition to `done` or `cancelled`.

## 4 - Priority enum

`priority` is a closed enum:

- `critical`
- `high`
- `medium`
- `low`

When teams also track severity, they SHOULD encode severity in `notes` or as
an additive key such as `severity`; they MUST still provide `priority`.

## 5 - Minimal worked example

```yaml
metadata:
  schema_version: 1
  generated_at: "2026-04-25T22:45:00Z"
  owners: [tech-lead, librarian]
  source_of_truth: /src/memory/backlog/index.yaml

items:
  - id: bootstrap-prd-hash-refresh
    title: Refresh TBD-on-commit content hashes
    source: src/memory/adr/0001-backlog-tracking.md
    owner: librarian
    milestone: phase-1
    status: open
    priority: high
    opened_at: "2026-04-25T22:45:00Z"
    links:
      - /src/memory/adr/0001-backlog-tracking.md
      - /AGENTS.md
    evidence: "Bootstrap context records unresolved contentHash placeholders."
    notes: "Run a repository-wide citation hash refresh after PRD revision."
```
