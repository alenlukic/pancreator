# Engineering Spec - @tesseract/checkpointer-fs

## Context
This feature folder captures Phase 2 delivery requirements for `@tesseract/checkpointer-fs`.

## Requirements
- The package implementation MUST satisfy contract `tesseract.checkpointer_fs.package_shape` for `src/internal/packages/@tesseract/checkpointer-fs/**`.
- The package README Quickstart section MUST satisfy contract `tesseract.checkpointer_fs.readme_ergonomics`.
- Work sequencing MUST preserve the BOOTSTRAP.md Phase 2 dependency order position 7 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
