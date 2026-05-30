/** Cursor IDE persona slugs that differ from `@cursor/sdk` model ids. */
const SDK_MODEL_ALIASES: Readonly<Record<string, string>> = {
  "claude-4.6-sonnet-medium-thinking": "claude-sonnet-4-6",
};

/**
 * Cursor IDE agent frontmatter allows model qualifiers such as `composer-2.5[fast=false]`.
 * The `@cursor/sdk` `Agent.prompt` API accepts bare model ids only.
 */
export function resolveSdkModelId(personaModel: string): string {
  const trimmed = personaModel.trim();
  const bracketIndex = trimmed.indexOf("[");
  const baseId = bracketIndex === -1 ? trimmed : trimmed.slice(0, bracketIndex).trim();
  return SDK_MODEL_ALIASES[baseId] ?? baseId;
}
