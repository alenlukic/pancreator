# @tesseract/contract-style

String-level Layer 1 weasel detection against the ban list in `/src/memory/handbook/contract-style.md` Rule 1.6. Full Layer 1 lint uses tree-sitter in the handbook description; this package supports quick local checks.

## Quickstart

From the repository root:

1. `pnpm install`
2. `pnpm --filter @tesseract/contract-style build`
3. `pnpm --filter @tesseract/contract-style typecheck`
4. `pnpm --filter @tesseract/contract-style test`
5. `pnpm --filter @tesseract/contract-style publint`
