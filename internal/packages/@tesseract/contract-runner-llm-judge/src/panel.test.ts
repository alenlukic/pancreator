import { describe, expect, it } from "vitest";

import {
  defaultMvpLlmJudgePanel,
  LLM_JUDGE_MVP_COST_CEILING_USD,
  LLM_JUDGE_MVP_JUDGES,
  LLM_JUDGE_MVP_QUORUM,
  LLM_JUDGE_MVP_SEED,
} from "./panel.js";

describe("defaultMvpLlmJudgePanel", () => {
  it("uses the closed MVP policy constants", () => {
    const p = defaultMvpLlmJudgePanel();
    expect(p.quorum).toBe(LLM_JUDGE_MVP_QUORUM);
    expect(p.judges).toEqual([...LLM_JUDGE_MVP_JUDGES]);
    expect(p.seed).toBe(LLM_JUDGE_MVP_SEED);
    expect(p.costCeilingUsd).toBe(LLM_JUDGE_MVP_COST_CEILING_USD);
  });
});
