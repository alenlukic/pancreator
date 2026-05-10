import type { PersonaMetadata, PersonaSpec } from "./types.js";

const PERMISSION: ReadonlySet<string> = new Set(["default", "read-only"]);
const ISOLATION: ReadonlySet<string> = new Set(["worktree", "none"]);
const MEMORY: ReadonlySet<string> = new Set(["project", "private"]);
const EFFORT: ReadonlySet<string> = new Set(["low", "medium", "high"]);
const RISK: ReadonlySet<string> = new Set(["low", "medium", "high", "any"]);
const STABILITY: ReadonlySet<string> = new Set(["experimental", "stable", "deprecated"]);

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Returns a `PersonaSpec` when `data` satisfies structural rules; otherwise throws `Error`.
 */
export function assertPersonaSpec(data: Record<string, unknown>): PersonaSpec {
  const err = (msg: string) => new Error(`PersonaSpec: ${msg}`);

  const name = data.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw err("`name` MUST be a non-empty string.");
  }

  const description = data.description;
  if (typeof description !== "string") {
    throw err("`description` MUST be a string.");
  }

  const model = data.model;
  if (typeof model !== "string" || model.trim() === "") {
    throw err("`model` MUST be a non-empty string.");
  }

  const permissionMode = data.permissionMode;
  if (typeof permissionMode !== "string" || !PERMISSION.has(permissionMode)) {
    throw err("`permissionMode` MUST be `default` or `read-only`.");
  }

  const tools = data.tools;
  if (!Array.isArray(tools) || !tools.every((t) => typeof t === "string")) {
    throw err("`tools` MUST be a string array.");
  }

  const disallowedTools = data.disallowedTools;
  if (!Array.isArray(disallowedTools) || !disallowedTools.every((t) => typeof t === "string")) {
    throw err("`disallowedTools` MUST be a string array.");
  }

  const mcpServers = data.mcpServers;
  if (!Array.isArray(mcpServers) || !mcpServers.every((t) => typeof t === "string")) {
    throw err("`mcpServers` MUST be a string array.");
  }

  const maxTurns = data.maxTurns;
  if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1) {
    throw err("`maxTurns` MUST be a positive integer.");
  }

  const skills = data.skills;
  if (!Array.isArray(skills) || !skills.every((t) => typeof t === "string")) {
    throw err("`skills` MUST be a string array.");
  }

  const isolation = data.isolation;
  if (typeof isolation !== "string" || !ISOLATION.has(isolation)) {
    throw err("`isolation` MUST be `worktree` or `none`.");
  }

  const memory = data.memory;
  if (typeof memory !== "string" || !MEMORY.has(memory)) {
    throw err("`memory` MUST be `project` or `private`.");
  }

  const effort = data.effort;
  if (typeof effort !== "string" || !EFFORT.has(effort)) {
    throw err("`effort` MUST be `low`, `medium`, or `high`.");
  }

  const color = data.color;
  if (typeof color !== "string" || color.trim() === "") {
    throw err("`color` MUST be a non-empty string.");
  }

  if (data.hooks !== undefined) {
    if (!isRecord(data.hooks)) {
      throw err("`hooks` MUST be a YAML mapping when present.");
    }
  }

  if (data.initialPrompt !== undefined && typeof data.initialPrompt !== "string") {
    throw err("`initialPrompt` MUST be a string when present.");
  }

  if (data.background !== undefined && typeof data.background !== "string") {
    throw err("`background` MUST be a string when present.");
  }

  const metadata = data.metadata;
  if (!isRecord(metadata)) {
    throw err("`metadata` MUST be a YAML mapping.");
  }

  const tier = metadata["tesseract-risk-tier"];
  if (typeof tier !== "string" || !RISK.has(tier)) {
    throw err("`metadata.tesseract-risk-tier` MUST be `low`, `medium`, `high`, or `any`.");
  }

  const stages = metadata["tesseract-pipeline-stages"];
  if (!Array.isArray(stages) || !stages.every((s) => typeof s === "string")) {
    throw err("`metadata.tesseract-pipeline-stages` MUST be a string array.");
  }

  const bootstrap = metadata["tesseract-bootstrap-only"];
  if (typeof bootstrap !== "boolean") {
    throw err("`metadata.tesseract-bootstrap-only` MUST be a boolean.");
  }

  const stability = metadata["tesseract-stability"];
  if (typeof stability !== "string" || !STABILITY.has(stability)) {
    throw err("`metadata.tesseract-stability` MUST be `experimental`, `stable`, or `deprecated`.");
  }

  const checklist = metadata["tesseract-checklist"];
  if (!Array.isArray(checklist) || !checklist.every((c) => typeof c === "string")) {
    throw err("`metadata.tesseract-checklist` MUST be a string array.");
  }

  const anchors = metadata["tesseract-handbook-anchors"];
  if (anchors !== undefined) {
    if (!Array.isArray(anchors) || !anchors.every((a) => typeof a === "string")) {
      throw err("`metadata.tesseract-handbook-anchors` MUST be a string array when present.");
    }
  }

  const out: PersonaSpec = {
    name,
    description,
    model,
    permissionMode: permissionMode as PersonaSpec["permissionMode"],
    tools,
    disallowedTools,
    mcpServers,
    maxTurns,
    skills,
    isolation: isolation as PersonaSpec["isolation"],
    memory: memory as PersonaSpec["memory"],
    effort: effort as PersonaSpec["effort"],
    color,
    metadata: metadata as PersonaMetadata,
  };

  if (isRecord(data.hooks)) {
    out.hooks = data.hooks;
  }
  if (typeof data.initialPrompt === "string") {
    out.initialPrompt = data.initialPrompt;
  }
  if (typeof data.background === "string") {
    out.background = data.background;
  }

  return out;
}

export function isPersonaSpec(x: unknown): x is PersonaSpec {
  try {
    assertPersonaSpec(x as Record<string, unknown>);
    return true;
  } catch {
    return false;
  }
}
