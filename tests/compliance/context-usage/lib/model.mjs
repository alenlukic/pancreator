import path from "node:path";

import { PROTOTYPE_MODELS } from "./tasks.mjs";

/** Mirrors {@link resolveSdkModelId} from runner-cursor sdk-model.ts (bracket stripping only). */
const SDK_MODEL_ALIASES = {
  "claude-4.6-sonnet-medium-thinking": "claude-sonnet-4-6",
};

/**
 * @param {string} personaModel
 */
export function resolveSdkModelId(personaModel) {
  const trimmed = personaModel.trim();
  const bracketIndex = trimmed.indexOf("[");
  const baseId = bracketIndex === -1 ? trimmed : trimmed.slice(0, bracketIndex).trim();
  return SDK_MODEL_ALIASES[baseId] ?? baseId;
}

export const HARNESS_MODEL = "composer-2.5";

/**
 * @param {string} modelId
 */
export function assertPrototypeModel(modelId) {
  const resolved = resolveSdkModelId(modelId);
  if (!PROTOTYPE_MODELS.includes(resolved)) {
    throw new Error(
      `[context-usage] model "${modelId}" is not in prototype matrix (${PROTOTYPE_MODELS.join(", ")})`,
    );
  }
  return resolved;
}

/**
 * @param {string[]} args
 * @param {string} [defaultModel]
 */
export function parseModelArg(args, defaultModel = HARNESS_MODEL) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model" && args[i + 1]) {
      return assertPrototypeModel(args[i + 1]);
    }
    if (arg.startsWith("--model=")) {
      return assertPrototypeModel(arg.slice("--model=".length));
    }
  }
  return assertPrototypeModel(defaultModel);
}

/**
 * @param {string} harnessRoot
 * @param {string} modelId
 */
export function resolveOverheadBaselinePath(harnessRoot, modelId) {
  const normalized = resolveSdkModelId(modelId);
  return path.join(harnessRoot, "baselines", `overhead.${normalized}.json`);
}
