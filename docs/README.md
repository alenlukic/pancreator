# Docs (internal surface)

This directory holds **internal** Pancreator product documents used to plan and
build Pancreator itself. The entire tree is excluded from default Cursor semantic
indexing; open paths explicitly when doing Pancreator self-development.

**External operators** running feature delivery on a target project SHALL use
`README.md` §Delivery operating card and `OPERATION.md` instead of this directory.

## Contents

- `PRD.summary.md` — compact product orientation.
- `PRD.index.md` — section-level routing into the full PRD.
- `M1.index.md` — M1 compact route map.
- `PRD.md` — full product requirements.
- `BOOTSTRAP.md` — closed historical phase record (phases −1 through 5).

## Internal routing order

1. `docs/PRD.summary.md` and `docs/PRD.index.md`
2. `docs/M1.index.md` when bootstrap or M1 scope applies
3. Full `docs/PRD.md` or `docs/BOOTSTRAP.md` when line-anchored authority is required

Pancreator self-development operating contract: root `AGENTS.md`.
