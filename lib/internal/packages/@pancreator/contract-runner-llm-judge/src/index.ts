/**
 * @packageDocumentation
 * Presets for the MVP `llm-judge` runner. The panel invokes external model APIs out-of-process in later work.
 */
export { PANCREATOR_CORE_VERSION } from "@pancreator/core";

export {
  defaultMvpLlmJudgePanel,
  LLM_JUDGE_MVP_COST_CEILING_USD,
  LLM_JUDGE_MVP_JUDGES,
  LLM_JUDGE_MVP_QUORUM,
  LLM_JUDGE_MVP_SEED,
} from "./panel.js";
export type { LlmJudgePanel } from "./panel.js";

export const PANCREATOR_CONTRACT_RUNNER_LLM_JUDGE_STUB = "contract-runner-llm-judge" as const;

import { PANCREATOR_CORE_VERSION } from "@pancreator/core";

/**
 * Returns the `pancreator` monorepo version string from `@pancreator/core`.
 */
export function contractRunnerLlmJudgeStubVersion(): string {
  return PANCREATOR_CORE_VERSION;
}
