import { stringify as stringifyYaml } from "yaml";
import type { PersonaSpec } from "./types.js";

const YAML_OPT = { lineWidth: 0, defaultKeyType: "PLAIN" as const, indent: 2 };

/**
 * Emits a full `lib/personas/<name>.md` (or `.cursor/agents/<name>.md` mirror) document that
 * round-trips with {@link parsePersonaMarkdown} when `frontmatter` is the same mapping from parse.
 */
export function emitPersonaMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const yamlText = stringifyYaml(frontmatter, YAML_OPT).replace(/\n$/, "");
  return `---\n${yamlText}\n---\n${body}`;
}

/**
 * Emits the canonical `.cursor/agents/<name>.md` mirror text: same shape as
 * `emitPersonaMarkdown` (full file content).
 */
export function emitCursorAgentsMirror(frontmatter: Record<string, unknown>, body: string): string {
  return emitPersonaMarkdown(frontmatter, body);
}

export interface MdcShimOptions {
  /** Rule globs; default is one entry `lib/personas/<name>.md`. */
  globs?: string[];
  /** When `true`, matches `00-*` priority rules. Personas use `false`. */
  alwaysApply?: boolean;
}

/**
 * Emits `.cursor/rules/<name>.mdc` per `/lib/memory/handbook/persona-spec.md` §5.2: five
 * non-blank frontmatter lines plus a single `@lib/personas/<name>.md` body line.
 */
export function emitMdcShim(spec: PersonaSpec, options: MdcShimOptions = {}): string {
  const globs = options.globs ?? [`lib/personas/${spec.name}.md`];
  const alwaysApply = options.alwaysApply ?? false;
  const header = {
    description: spec.description,
    globs,
    alwaysApply,
  };
  const yamlText = stringifyYaml(header, YAML_OPT).replace(/\n$/, "");
  return `---\n${yamlText}\n---\n\n@lib/personas/${spec.name}.md\n`;
}
