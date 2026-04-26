# Engineering Spec - @tesseract/contract-style

## Context
This feature folder captures Phase 2 delivery requirements for `@tesseract/contract-style`.

## Requirements
- The package implementation MUST satisfy contract `tesseract.contract_style.package_shape` for `packages/@tesseract/contract-style/**`.
- The package README Quickstart section MUST satisfy contract `tesseract.contract_style.readme_ergonomics`.
- Work sequencing MUST preserve the BOOTSTRAP.md Phase 2 dependency order position 5 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
