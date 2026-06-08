---
title: Engineering Spec - @pancreator/cli
feature_id: pancreator-cli
lifecycle_stage: contracts-authored
---

# Engineering Spec - @pancreator/cli

## Context
This feature folder captures Phase 2 delivery requirements for `@pancreator/cli`.

## Requirements
- The package implementation MUST satisfy contract `pancreator.cli.package_shape` for `lib/internal/packages/@pancreator/cli/**`.
- The package README Quickstart section MUST satisfy contract `pancreator.cli.readme_ergonomics`.
- Work sequencing MUST preserve the .docs/BOOTSTRAP.md Phase 2 dependency order position 19 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
