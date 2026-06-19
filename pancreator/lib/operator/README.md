---
slug: operator-surface-index
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [supervisor, tech-writer, librarian]
purpose: "Repo-owned landing page for operator-facing visual references, canvas catalog entries, and human navigation surfaces."
related:
  - /lib/operator/canvases.md
  - /lib/memory/handbook/operator-output-contract.md
  - /lib/memory/handbook/feature-delivery-pipeline-overview.md
...

# Operator section
- 👀 **In this file:** Landing page for operator-facing visual references and canvas catalog entries.
- ⚖️ **Why it matters:** Gives humans one stable repo location for the visual surfaces that are easiest to scan during delivery and governance work.
- 🧭 **See also:**
  - /lib/operator/canvases.md
  - /lib/memory/handbook/feature-delivery-pipeline-overview.md
  - /lib/memory/handbook/operator-output-contract.md

# Operator Surface Index

This directory is the repo-owned catalog for operator-facing visual artifacts.
It exists because rendered Cursor canvases do not live inside the repository:
the live `.canvas.tsx` files must stay under Cursor's managed workspace canvas
directory, while the repository needs a durable place to document what those
canvases are for and which repo artifacts back them.

## What lives here

- `canvases.md` — canonical catalog of operator-facing canvases, their audience,
  and the repo artifacts they summarize or complement.
- future operator-facing indexes, runbooks, or visual-reference catalogs that are
  easier for humans to browse than raw contracts.

## Current direction

The intent is to keep contract-heavy material in durable handbook pages, while
also maintaining visual-first canvases for:

- pipeline walkthroughs;
- delivery and governance dashboards;
- audit summaries;
- workflow-health and queue-health views; and
- other operator-heavy references where cards, tables, and compact visual
  summaries are easier to parse than long Markdown.

## Constraints

- The repository SHOULD own the index and conventions for operator canvases.
- The live `.canvas.tsx` files MUST remain in Cursor's managed canvas directory
  so the IDE can render them.
- Repo docs in this directory SHOULD describe canvas names, purpose, and backing
  sources without depending on machine-specific absolute paths.
