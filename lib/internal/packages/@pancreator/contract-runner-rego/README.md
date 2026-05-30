# @pancreator/contract-runner-rego

Helpers for Rego-shaped `input` objects that Phase 2 policies read. OPA and Conftest stay out-of-process; this package only types the JSON surface.

## Quickstart

From the repository root:

1. `pnpm install`
2. `pnpm --filter @pancreator/contract-runner-rego build`
3. `pnpm --filter @pancreator/contract-runner-rego typecheck`
4. `pnpm --filter @pancreator/contract-runner-rego test`
5. `pnpm --filter @pancreator/contract-runner-rego publint`
