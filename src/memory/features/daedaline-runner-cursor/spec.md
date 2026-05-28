---
title: Engineering Spec - @daedaline/runner-cursor
feature_id: daedaline-runner-cursor
lifecycle_stage: contracts-authored
---

# Engineering Spec - @daedaline/runner-cursor

## Context
This feature folder captures Phase 2 delivery requirements for `@daedaline/runner-cursor`.

## Requirements
- The package implementation MUST satisfy contract `daedaline.runner_cursor.package_shape` for `src/internal/packages/@daedaline/runner-cursor/**`.
- The package README Quickstart section MUST satisfy contract `daedaline.runner_cursor.readme_ergonomics`.
- Work sequencing MUST preserve the docs/BOOTSTRAP.md Phase 2 dependency order position 13 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
