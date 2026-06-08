---
template: delivery-report
slug: delivery-report
stability: experimental
phase: 1
allowed-in-milestones: [M1+]
purpose: |
  Scaffold for feature-delivery Delivery Reports authored by tech-writer at the
  report stage. Each claim carries a fenced canonical JSON dual-anchor citation.
references:
  - kind: lines
    path: lib/personas/tech-writer.md
    range: [80, 137]
    contentHash: ea46720
    note: "Delivery Report structure and citation conformance gates."
---

# Template — Delivery Report

Use this template when authoring `lib/memory/features/<id>/delivery-report.md`.
Copy the section headings and citation shape; replace placeholders with run-specific
content from the six upstream inputs.

## Summary

One paragraph at most 150 words capturing the shipped change.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/implementation-report.md",
  "range": [1, 20],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Architecture

- Major design decision one.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/plan.md",
  "range": [1, 30],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Interfaces

- Public symbol or surface changed.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/implementation-report.md",
  "range": [21, 40],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Tradeoffs

- Accepted constraint or rejected alternative.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/review.md",
  "range": [1, 20],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Usage guidelines

Example one with passing test citation.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/test-report.md",
  "range": [1, 15],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Testing

Coverage delta paragraph.

```json
{
  "kind": "lines",
  "path": ".pan/work/<day>/<task-id>/test-report.md",
  "range": [16, 40],
  "contentHash": "<abbreviated-git-blob-hash>"
}
```

## Citation rules

- Each claim MUST use a fenced `json` block with double-quoted keys.
- JS-literal `{kind: lines, path: ...}` inline form is forbidden.
- Compact single-line `{"kind":"lines",...}` blobs are forbidden.
- `contentHash` MUST use the abbreviated git blob prefix, not placeholders like `0000000`.

See `lib/personas/tech-writer.md` §Conformance gates and
`lib/memory/handbook/contract-templates/delivery-report.template.md`.
