import { parsePersonaMarkdown } from "@pancreator/persona";
import type { PersonaSpec } from "@pancreator/persona";
import type { RunnerPersonaInput } from "@pancreator/runner-cursor";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export class PersonaResolveError extends Error {
  override readonly name = "PersonaResolveError";

  constructor(message: string) {
    super(message);
  }
}

export async function listKnownPersonaIds(repoRoot: string): Promise<Set<string>> {
  const dir = path.join(repoRoot, "src", "personas");
  try {
    const entries = await readdir(dir);
    return new Set(
      entries.filter((entry) => entry.endsWith(".md")).map((entry) => entry.replace(/\.md$/u, "")),
    );
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return new Set();
    }
    throw error;
  }
}

export async function resolvePersona(repoRoot: string, personaId: string): Promise<RunnerPersonaInput> {
  const rel = path.posix.join("src", "personas", `${personaId}.md`);
  const abs = path.join(repoRoot, rel);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new PersonaResolveError(`Unknown persona "${personaId}"; expected ${rel}.`);
    }
    throw error;
  }
  const { spec } = parsePersonaMarkdown(raw);
  if (spec.name !== personaId) {
    throw new PersonaResolveError(
      `Persona file ${rel} frontmatter name "${spec.name}" does not match id "${personaId}".`,
    );
  }
  return personaSpecToRunnerInput(spec);
}

function personaSpecToRunnerInput(spec: PersonaSpec): RunnerPersonaInput {
  return {
    name: spec.name,
    description: spec.description,
    model: spec.model,
    permissionMode: spec.permissionMode,
    tools: spec.tools,
    disallowedTools: spec.disallowedTools,
    mcpServers: spec.mcpServers,
    maxTurns: spec.maxTurns,
    skills: spec.skills,
    isolation: spec.isolation,
    memory: spec.memory,
    effort: spec.effort,
    color: spec.color,
    metadata: spec.metadata,
  };
}
