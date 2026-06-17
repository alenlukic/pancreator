import { describe, expect, it } from "vitest";

import { readSdkSamplingConfig } from "./pan-init.js";
import { sampleRateForKeys, shouldSampleSdkInvocation } from "./sdk-sampling.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

describe("sdk-sampling", () => {
  it("shouldSampleSdkInvocation is deterministic for the same key", () => {
    const config = { enabled: true, ratePercent: 10, scope: "feature-delivery" };
    const key = {
      taskId: "53589_0906_sampled-token-audit",
      stageId: "implement",
      persona: "coder",
      model: "composer-2.5",
      invocationIndex: 0,
    };
    const first = shouldSampleSdkInvocation({ config, ...key });
    const second = shouldSampleSdkInvocation({ config, ...key });
    expect(first).toBe(second);
  });

  it("default 10 percent gate samples roughly 10 percent of synthetic keys", () => {
    const config = { enabled: true, ratePercent: 10, scope: "feature-delivery" };
    const keys = Array.from({ length: 500 }, (_, i) => ({
      taskId: `task-${i}`,
      stageId: "implement",
      persona: "coder",
      model: "composer-2.5",
      invocationIndex: i % 5,
    }));
    const rate = sampleRateForKeys(config, keys);
    expect(rate).toBeGreaterThan(0.04);
    expect(rate).toBeLessThan(0.2);
  });

  it("readSdkSamplingConfig honors force-off override", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pan-sampling-"));
    await writeFile(
      path.join(root, "pancreator.yaml"),
      `project_root: "."
runner:
  cursor:
    sdkSampling:
      enabled: true
      ratePercent: 100
      scope: feature-delivery
`,
      "utf8",
    );
    const prev = process.env.PAN_SDK_SAMPLING_FORCE_OFF;
    process.env.PAN_SDK_SAMPLING_FORCE_OFF = "1";
    try {
      const cfg = await readSdkSamplingConfig(root);
      expect(cfg.enabled).toBe(false);
    } finally {
      if (prev === undefined) {
        delete process.env.PAN_SDK_SAMPLING_FORCE_OFF;
      } else {
        process.env.PAN_SDK_SAMPLING_FORCE_OFF = prev;
      }
    }
  });
});
