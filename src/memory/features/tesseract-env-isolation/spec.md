---
title: Engineering Spec - @tesseract/env-isolation
feature_id: tesseract-env-isolation
lifecycle_stage: contracts-authored
---

# Engineering Spec - @tesseract/env-isolation

## Context
This feature folder captures Phase 2 delivery requirements for `@tesseract/env-isolation`.

## Requirements
- The package implementation MUST satisfy contract `tesseract.env_isolation.package_shape` for `src/internal/packages/@tesseract/env-isolation/**`.
- The package README Quickstart section MUST satisfy contract `tesseract.env_isolation.readme_ergonomics`.
- Work sequencing MUST preserve the docs/BOOTSTRAP.md Phase 2 dependency order position 15 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
