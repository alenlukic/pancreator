/**
 * Quorum string from PRD section 4.5 for MVP `llm-judge` clauses.
 */
export const LLM_JUDGE_MVP_QUORUM = "2-of-3" as const;

/**
 * Default judge list from PRD section 4.5 for MVP `llm-judge` clauses.
 */
export const LLM_JUDGE_MVP_JUDGES = ["haiku", "haiku", "sonnet"] as const;

/**
 * Default cost ceiling in USD for one `llm-judge` run (PRD section 4.5 and risk R28).
 */
export const LLM_JUDGE_MVP_COST_CEILING_USD = 0.5 as const;

/**
 * Default deterministic panel seed in PRD `contract-templates` and feature contracts.
 */
export const LLM_JUDGE_MVP_SEED = 42 as const;

/**
 * A configured panel that matches the MVP policy for `llm-judge` runtime blocks.
 */
export type LlmJudgePanel = {
  quorum: typeof LLM_JUDGE_MVP_QUORUM;
  judges: readonly string[];
  seed: number;
  costCeilingUsd: number;
};

/**
 * Returns the default Phase 2 `llm-judge` panel. Callers may override fields in later steps.
 */
export function defaultMvpLlmJudgePanel(): LlmJudgePanel {
  return {
    quorum: LLM_JUDGE_MVP_QUORUM,
    judges: [...LLM_JUDGE_MVP_JUDGES],
    seed: LLM_JUDGE_MVP_SEED,
    costCeilingUsd: LLM_JUDGE_MVP_COST_CEILING_USD,
  };
}
