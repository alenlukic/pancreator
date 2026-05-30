/**
 * Cursor IDE agent frontmatter allows model qualifiers such as `composer-2.5[fast=false]`.
 * The `@cursor/sdk` `Agent.prompt` API accepts bare model ids only.
 */
export function resolveSdkModelId(personaModel: string): string {
  const trimmed = personaModel.trim();
  const bracketIndex = trimmed.indexOf("[");
  if (bracketIndex === -1) {
    return trimmed;
  }
  return trimmed.slice(0, bracketIndex).trim();
}
