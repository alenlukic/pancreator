---
title: Engineering Spec - @pancreator/adopter-scan
feature_id: pancreator-adopter-scan
lifecycle_stage: contracts-authored
---

# Engineering Spec - @pancreator/adopter-scan

## Context
This feature folder captures Phase 2 delivery requirements for `@pancreator/adopter-scan`.

## Requirements
- The package implementation MUST satisfy contract `pancreator.adopter_scan.package_shape` for `lib/internal/packages/@pancreator/adopter-scan/**`.
- The package README Quickstart section MUST satisfy contract `pancreator.adopter_scan.readme_ergonomics`.
- Work sequencing MUST preserve the docs/BOOTSTRAP.md Phase 2 dependency order position 17 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
