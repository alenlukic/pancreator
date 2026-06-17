import { createHash } from "node:crypto";

export interface SdkSamplingConfig {
  enabled: boolean;
  ratePercent: number;
  scope: string;
}

export const DEFAULT_SDK_SAMPLING_CONFIG: SdkSamplingConfig = {
  enabled: true,
  ratePercent: 10,
  scope: "feature-delivery",
};

export function shouldSampleSdkInvocation(input: {
  config: SdkSamplingConfig;
  taskId: string;
  stageId: string;
  persona: string;
  model: string;
  invocationIndex: number;
}): boolean {
  if (!input.config.enabled || input.config.scope !== "feature-delivery") {
    return false;
  }
  const rate = Math.min(100, Math.max(0, input.config.ratePercent));
  if (rate <= 0) {
    return false;
  }
  if (rate >= 100) {
    return true;
  }
  const payload = [
    input.taskId,
    input.stageId,
    input.persona,
    input.model,
    String(input.invocationIndex),
  ].join("|");
  const hash = createHash("sha256").update(payload).digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return bucket < rate;
}

/** Offline distribution helper for tests — returns sampled count over synthetic keys. */
export function sampleRateForKeys(
  config: SdkSamplingConfig,
  keys: Array<{
    taskId: string;
    stageId: string;
    persona: string;
    model: string;
    invocationIndex: number;
  }>,
): number {
  if (keys.length === 0) {
    return 0;
  }
  const sampled = keys.filter((key) => shouldSampleSdkInvocation({ config, ...key })).length;
  return sampled / keys.length;
}
