import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildFallbackChain,
  isModelIssue,
  loadModelEscalationConfig,
  ModelEscalationConfigError,
  parseModelEscalationFile,
  resolveActiveConfigName,
  resolveEffectiveModel,
} from "./model-escalation.js";

const TEST_CONFIG = `active_config: test

configs:
  test:
    personas:
      coder:
        default: model-default
        3: model-tier-3
        4: model-tier-4
      reviewer:
        default: auto
        1: model-reviewer-1
`;

afterEach(() => {
  delete process.env.PAN_MODEL_ESCALATION_CONFIG;
});

describe("model escalation resolver", () => {
  it("resolves default, gap, exact, and highest-below tier semantics", () => {
    const loaded = {
      activeConfigName: "test",
      config: parseModelEscalationFile(TEST_CONFIG).configs.test!,
      filePath: "/tmp/config.yaml",
    };
    expect(resolveEffectiveModel(loaded, "coder", 0).model).toBe("model-default");
    expect(resolveEffectiveModel(loaded, "coder", 1).model).toBe("model-default");
    expect(resolveEffectiveModel(loaded, "coder", 3).model).toBe("model-tier-3");
    expect(resolveEffectiveModel(loaded, "coder", 5).model).toBe("model-tier-4");
    expect(resolveEffectiveModel(loaded, "reviewer", 0).model).toBe("auto");
    expect(resolveEffectiveModel(loaded, "reviewer", 1).model).toBe("model-reviewer-1");
  });

  it("walks fallback chain in down-chain, default, up-chain, auto order", () => {
    const loaded = {
      activeConfigName: "test",
      config: parseModelEscalationFile(TEST_CONFIG).configs.test!,
      filePath: "/tmp/config.yaml",
    };
    const chain = buildFallbackChain(loaded, "coder", 3, "model-tier-3");
    expect(chain).toEqual(["model-default", "model-tier-4", "auto"]);
  });

  it("prefers PAN_MODEL_ESCALATION_CONFIG over pancreator.yaml", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-escalation-env-"));
    await writeFile(path.join(root, "pancreator-model-escalation.yaml"), TEST_CONFIG, "utf8");
    await writeFile(
      path.join(root, "pancreator.yaml"),
      "runner:\n  cursor:\n    model_escalation:\n      config: test\n",
      "utf8",
    );
    process.env.PAN_MODEL_ESCALATION_CONFIG = "missing-config";
    let thrown: unknown;
    try {
      await loadModelEscalationConfig(root);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ModelEscalationConfigError);
    expect((thrown as Error).message).toContain('Active escalation config "missing-config"');
  });
});

describe("isModelIssue", () => {
  it("matches model capacity errors and ignores missing artifact failures", () => {
    expect(isModelIssue({ status: "error", errorMessage: "unknown model foo" })).toBe(true);
    expect(isModelIssue({ status: "error", errorMessage: "rate limit exceeded" })).toBe(true);
    expect(
      isModelIssue({
        status: "error",
        errorMessage: "required artifacts missing",
        missingArtifacts: ["work/demo/plan.md"],
      }),
    ).toBe(false);
  });
});

describe("resolveActiveConfigName", () => {
  it("uses pancreator.yaml override when env is unset", () => {
    const root = path.join(os.tmpdir(), "pan-escalation-yaml");
    const fileConfig = parseModelEscalationFile(TEST_CONFIG);
    const original = process.env.PAN_MODEL_ESCALATION_CONFIG;
    delete process.env.PAN_MODEL_ESCALATION_CONFIG;
    const name = resolveActiveConfigName(fileConfig, root);
    expect(name).toBe("test");
    if (original !== undefined) {
      process.env.PAN_MODEL_ESCALATION_CONFIG = original;
    }
  });
});
