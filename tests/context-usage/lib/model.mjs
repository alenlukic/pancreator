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
