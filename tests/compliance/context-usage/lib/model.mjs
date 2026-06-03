import path from "node:path";

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
 * @param {string[]} args
 * @param {string} [defaultModel]
 */
export function parseModelArg(args, defaultModel = HARNESS_MODEL) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--model" && args[i + 1]) {
      return resolveSdkModelId(args[i + 1]);
    }
    if (arg.startsWith("--model=")) {
      return resolveSdkModelId(arg.slice("--model=".length));
    }
  }
  return resolveSdkModelId(defaultModel);
}

/**
 * @param {string} modelId
 */
export function baselineFileNameForModel(modelId) {
  const normalized = resolveSdkModelId(modelId);
  return `${normalized}.json`;
}

/**
 * @param {string} harnessRoot
 * @param {string} modelId
 */
export function resolveModelBaselinePath(harnessRoot, modelId) {
  return path.join(harnessRoot, "baselines", baselineFileNameForModel(modelId));
}

/**
 * @param {string} harnessRoot
 * @param {string} modelId
 */
export function resolveFdSessionBaselinePath(harnessRoot, modelId) {
  return path.join(harnessRoot, "baselines", `fd-session.${baselineFileNameForModel(modelId)}`);
}
