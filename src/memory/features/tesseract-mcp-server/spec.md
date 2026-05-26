---
title: Engineering Spec - @tesseract/mcp-server
feature_id: tesseract-mcp-server
lifecycle_stage: contracts-authored
---

# Engineering Spec - @tesseract/mcp-server

## Context
This feature folder captures Phase 2 delivery requirements for `@tesseract/mcp-server`.

## Requirements
- The package implementation MUST satisfy contract `tesseract.mcp_server.package_shape` for `src/internal/packages/@tesseract/mcp-server/**`.
- The package README Quickstart section MUST satisfy contract `tesseract.mcp_server.readme_ergonomics`.
- Work sequencing MUST preserve the docs/BOOTSTRAP.md Phase 2 dependency order position 20 of 20.

## Non-Goals
- Defining M2+ scope for new contract kinds.
- Expanding this feature folder beyond the package's current contract surface.

## Acceptance Criteria
- Both registered contracts pass at `severity: block`.
- `spec.md`, `plan.md`, and `tasks.md` remain aligned with `contracts.index.json`.
