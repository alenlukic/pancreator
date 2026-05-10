# Engineering Spec - @tesseract/contract-runner-rego

## Context
This feature folder captures Phase 2 delivery requirements for `@tesseract/contract-runner-rego`.

## Requirements
- The package implementation MUST satisfy contract `tesseract.contract_runner_rego.package_shape` for `src/internal/packages/@tesseract/contract-runner-rego/**`.
- The package README Quickstart section MUST satisfy contract `tesseract.contract_runner_rego.readme_ergonomics`.
- Work sequencing MUST preserve the BOOTSTRAP.md Phase 2 dependency order position 3 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
