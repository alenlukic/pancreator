import { parse as parseYaml } from "yaml";
import type { ParsedPersonaFile } from "./types.js";
import { assertPersonaSpec } from "./validate.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/**
 * Splits a persona Markdown file into YAML frontmatter and body, parses YAML, and validates
 * the 16-field Anthropic shape plus Tesseract `metadata` per `/memory/handbook/persona-spec.md`.
 */
export function parsePersonaMarkdown(source: string): ParsedPersonaFile {
  const m = source.match(FRONTMATTER);
  if (!m) {
    throw new Error("Persona file MUST start with YAML frontmatter fenced by `---` delimiters.");
  }
  const yamlBlock = m[1] ?? "";
  const body = m[2] ?? "";
  let data: unknown;
  try {
    data = parseYaml(yamlBlock);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Persona YAML is not valid: ${msg}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Persona frontmatter MUST be a YAML mapping.");
  }
  const record = data as Record<string, unknown>;
  const spec = assertPersonaSpec(record);
  return { spec, body, frontmatter: record };
}
