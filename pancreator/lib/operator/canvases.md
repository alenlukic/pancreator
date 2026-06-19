---
slug: operator-canvas-catalog
stability: experimental
bootstrap-only: false
phase: "0b"
owners: [supervisor, tech-writer, librarian]
purpose: "Catalog of operator-facing Cursor canvases and the repo artifacts they summarize."
related:
  - /lib/operator/README.md
  - /lib/memory/handbook/feature-delivery-pipeline-overview.md
  - /lib/memory/handbook/operator-output-contract.md
...

# Operator section
- 👀 **In this file:** Catalog of operator-facing canvases and their backing repo artifacts.
- ⚖️ **Why it matters:** Lets humans find the visual-first references without scanning chat history or reverse-engineering which document produced a canvas.
- 🧭 **See also:**
  - /lib/operator/README.md
  - /lib/memory/handbook/feature-delivery-pipeline-overview.md
  - /lib/memory/handbook/pipeline-state-contract.md

# Operator Canvas Catalog

This catalog records operator-facing canvases that are intentionally easier for a
human to scan than the underlying contracts or handbook pages.

Because Cursor only renders canvases from its managed workspace canvas
directory, the repo stores the durable catalog and backing references here
rather than trying to check in the live `.canvas.tsx` files under `lib/`.

## Current canvases

| Canvas id | Primary audience | What it shows | Backing repo artifacts |
| --- | --- | --- | --- |
| `fd-pipeline-summary` | operators, tech-lead, supervisor | compact state-machine view of the feature-delivery pipeline, stage cards, transition matrix, and Mermaid graph | `lib/pipelines/feature-delivery.yaml`, `lib/memory/handbook/pipeline-state-contract.md`, `lib/personas/*.md`, `lib/internal/packages/@pancreator/cli/src/feature-delivery-run.ts`, `lib/internal/packages/@pancreator/cli/src/feature-delivery-gate-validation.ts`, `lib/memory/handbook/feature-delivery-pipeline-overview.md` |
| `operator-home` | operators | landing page for the visual surfaces in this workspace, plus quick links into the backing repo artifacts | `lib/operator/README.md`, `lib/operator/canvases.md` |

## Promotion criteria

A view is a good operator canvas candidate when:

- the primary value is fast human triage rather than machine validation;
- a compact table, card layout, or dashboard communicates better than long prose;
- the source data already exists in repo docs, work artifacts, or machine outputs;
- the result benefits from being opened beside the chat as a living reference.

## Authoring rules

- The repo SHOULD store the durable catalog entry and the backing source docs.
- The rendered `.canvas.tsx` file MUST live in Cursor's managed canvas directory.
- Every new operator canvas SHOULD identify its backing repo artifacts in this
  catalog.
- When a canvas summarizes a durable repo concept, the repo SHOULD also retain a
  Markdown source of record such as a handbook page, audit artifact, or runbook.

## Backlog ideas

- workflow-health dashboard
- compliance audit summary canvas
- inbox and active-run queue overview
- artifact lineage explorer for one feature-delivery task
