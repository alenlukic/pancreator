# Docs

This directory holds high-level product and bootstrap documents that operators may need, but that should not clutter the repository root.

- `M1.index.md` — compact M1/bootstrap route map; read this before opening full bootstrap or PRD sources for routine M1 work.
- `PRD.summary.md` — compact product orientation.
- `PRD.index.md` — section-level PRD routing map.
- `PRD.md` — full product requirements; explicit-read by default for detailed requirements and line-anchored citations.
- `BOOTSTRAP.md` — historical record of the completed bootstrap (phases −1 through 5, M1 ratified 2026-05-31). Retained as the canonical, replayable phase sequence behind the `Bootstrap-Phase` commit trailer and `pan re-adopt` lineage; explicit-read by default when compact routing is insufficient. Live state lives in `../pancreator.yaml`.

- `../pancreator.yaml` — live bootstrap tracking and `project_root`; route through `../lib/memory/handbook/pancreator-config.md` before editing.
