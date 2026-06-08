---
title: Engineering Spec - @pancreator/contract
feature_id: pancreator-contract
lifecycle_stage: contracts-authored
---

# Engineering Spec - @pancreator/contract

## Context
This feature folder captures Phase 2 delivery requirements for `@pancreator/contract`.

## Requirements
- The package implementation MUST satisfy contract `pancreator.contract.package_shape` for `lib/internal/packages/@pancreator/contract/**`.
- The package README Quickstart section MUST satisfy contract `pancreator.contract.readme_ergonomics`.
- Work sequencing MUST preserve the .docs/BOOTSTRAP.md Phase 2 dependency order position 2 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
