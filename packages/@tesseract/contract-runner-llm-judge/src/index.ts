import { TESSERACT_CORE_VERSION } from "@tesseract/core";

/**
 * @packageDocumentation Phase 0a scaffold. LLM judge runner lands in Phase 2+.
 */
export const TESSERACT_CONTRACT_RUNNER_LLM_JUDGE_STUB = "contract-runner-llm-judge" as const;

export function contractRunnerLlmJudgeStubVersion(): string {
  return TESSERACT_CORE_VERSION;
}
