/**
 * @packageDocumentation
 * Presets for the MVP `llm-judge` runner. The panel invokes external model APIs out-of-process in later work.
 */
export { DAEDALINE_CORE_VERSION } from "@daedaline/core";

export {
  defaultMvpLlmJudgePanel,
  LLM_JUDGE_MVP_COST_CEILING_USD,
  LLM_JUDGE_MVP_JUDGES,
  LLM_JUDGE_MVP_QUORUM,
  LLM_JUDGE_MVP_SEED,
} from "./panel.js";
export type { LlmJudgePanel } from "./panel.js";

export const DAEDALINE_CONTRACT_RUNNER_LLM_JUDGE_STUB = "contract-runner-llm-judge" as const;

import { DAEDALINE_CORE_VERSION } from "@daedaline/core";

/**
 * Returns the `daedaline` monorepo version string from `@daedaline/core`.
 */
export function contractRunnerLlmJudgeStubVersion(): string {
  return DAEDALINE_CORE_VERSION;
}
