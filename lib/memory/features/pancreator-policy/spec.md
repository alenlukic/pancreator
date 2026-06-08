---
title: Engineering Spec - @pancreator/policy
feature_id: pancreator-policy
lifecycle_stage: contracts-authored
---

# Engineering Spec - @pancreator/policy

## Context
This feature folder captures Phase 2 delivery requirements for `@pancreator/policy`.

## Requirements
- The package implementation MUST satisfy contract `pancreator.policy.package_shape` for `lib/internal/packages/@pancreator/policy/**`.
- The package README Quickstart section MUST satisfy contract `pancreator.policy.readme_ergonomics`.
- Work sequencing MUST preserve the .docs/BOOTSTRAP.md Phase 2 dependency order position 18 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
