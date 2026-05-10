/**
 * @packageDocumentation
 * Presets for the MVP `llm-judge` runner. The panel invokes external model APIs out-of-process in later work.
 */
export { TESSERACT_CORE_VERSION } from "@tesseract/core";

export {
  defaultMvpLlmJudgePanel,
  LLM_JUDGE_MVP_COST_CEILING_USD,
  LLM_JUDGE_MVP_JUDGES,
  LLM_JUDGE_MVP_QUORUM,
  LLM_JUDGE_MVP_SEED,
} from "./panel.js";
export type { LlmJudgePanel } from "./panel.js";

export const TESSERACT_CONTRACT_RUNNER_LLM_JUDGE_STUB = "contract-runner-llm-judge" as const;

import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * Returns the `tesseract` monorepo version string from `@tesseract/core`.
 */
export function contractRunnerLlmJudgeStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
