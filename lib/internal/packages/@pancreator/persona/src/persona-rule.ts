import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const YAML_OPT = { lineWidth: 0, defaultKeyType: "PLAIN" as const, indent: 2 };

export interface PersonaRuleSpec {
  persona: string;
  description: string;
  globs: string[];
  alwaysApply: boolean;
}

function personaPathForProjection(persona: string, projectPrefix: string): string {
  if (projectPrefix === ".") {
    return `lib/personas/${persona}.md`;
  }
  return `${projectPrefix}/lib/personas/${persona}.md`;
}

/**
 * Parses a tool-agnostic persona rule at `lib/personas/rules/<name>.yaml`.
 */
export function parsePersonaRuleYaml(raw: string, expectedPersona?: string): PersonaRuleSpec {
  const data = parseYaml(raw);
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Persona rule must be a YAML mapping");
  }
  const record = data as Record<string, unknown>;
  const persona = record.persona;
  const description = record.description;
  const globs = record.globs;
  const alwaysApply = record.alwaysApply;

  if (typeof persona !== "string" || persona.trim() === "") {
    throw new Error("Persona rule requires non-empty persona");
  }
  if (expectedPersona !== undefined && persona !== expectedPersona) {
    throw new Error(`Persona rule persona ${persona} does not match file name ${expectedPersona}`);
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error(`Persona rule ${persona} requires non-empty description`);
  }
  if (!Array.isArray(globs) || globs.length === 0 || !globs.every((g) => typeof g === "string")) {
    throw new Error(`Persona rule ${persona} requires a non-empty globs string array`);
  }
  if (alwaysApply !== undefined && typeof alwaysApply !== "boolean") {
    throw new Error(`Persona rule ${persona} alwaysApply must be boolean when present`);
  }

  return {
    persona,
    description,
    globs: globs as string[],
    alwaysApply: alwaysApply === true,
  };
}

/**
 * Emits Cursor `.cursor/rules/<name>.mdc` from a tool-agnostic persona rule spec.
 */
export function emitCursorMdcFromPersonaRule(rule: PersonaRuleSpec, projectPrefix: string): string {
  const header = {
    description: rule.description,
    globs: rule.globs,
    alwaysApply: rule.alwaysApply,
  };
  const yamlText = stringifyYaml(header, YAML_OPT).replace(/\n$/, "");
  const personaPath = personaPathForProjection(rule.persona, projectPrefix);
  return `---\n${yamlText}\n---\n\n@${personaPath}\n`;
}
