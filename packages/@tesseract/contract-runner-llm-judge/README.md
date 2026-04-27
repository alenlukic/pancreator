# @tesseract/contract-runner-llm-judge

MVP defaults for `llm-judge` panel settings (quorum, judges, seed, cost ceiling). Model calls stay out-of-process until a later bootstrap step.

## Quickstart

From the repository root:

1. `pnpm install`
2. `pnpm --filter @tesseract/contract-runner-llm-judge build`
3. `pnpm --filter @tesseract/contract-runner-llm-judge typecheck`
4. `pnpm --filter @tesseract/contract-runner-llm-judge test`
5. `pnpm --filter @tesseract/contract-runner-llm-judge publint`
