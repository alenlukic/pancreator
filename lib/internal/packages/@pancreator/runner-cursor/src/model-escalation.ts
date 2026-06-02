import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { CursorSdkInvokeResult } from "./sdk-transport.js";

export class ModelEscalationConfigError extends Error {
  override readonly name = "ModelEscalationConfigError";
}

export interface PersonaEscalationTiers {
  default: string;
  [tierKey: string]: string;
}

export interface NamedEscalationConfig {
  personas: Record<string, PersonaEscalationTiers>;
}

export interface ModelEscalationFileConfig {
  active_config: string;
  configs: Record<string, NamedEscalationConfig>;
}

export interface LoadedModelEscalation {
  activeConfigName: string;
  config: NamedEscalationConfig;
  filePath: string;
}

const MODEL_ISSUE_PATTERNS: readonly RegExp[] = [
  /unknown model/i,
  /invalid model/i,
  /unsupported model/i,
  /model not found/i,
  /provider unavailable/i,
  /model unavailable/i,
  /temporarily unavailable/i,
  /service unavailable/i,
  /quota/i,
  /rate limit/i,
  /capacity exceeded/i,
  /too many requests/i,
];

function validateModelEscalationStructure(config: unknown): string[] {
  const errors: string[] = [];
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return ["config MUST be an object"];
  }
  const root = config as Record<string, unknown>;
  if (typeof root.active_config !== "string" || root.active_config.length === 0) {
    errors.push("active_config MUST be a non-empty string");
  }
  const configs = root.configs;
  if (configs === null || typeof configs !== "object" || Array.isArray(configs)) {
    errors.push("configs MUST be an object");
    return errors;
  }
  for (const [name, entry] of Object.entries(configs as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`configs.${name} MUST be an object`);
      continue;
    }
    const personas = (entry as Record<string, unknown>).personas;
    if (personas === null || typeof personas !== "object" || Array.isArray(personas)) {
      errors.push(`configs.${name}.personas MUST be an object`);
      continue;
    }
    for (const [slug, tiers] of Object.entries(personas as Record<string, unknown>)) {
      if (tiers === null || typeof tiers !== "object" || Array.isArray(tiers)) {
        errors.push(`configs.${name}.personas.${slug} MUST be an object`);
        continue;
      }
      const tierMap = tiers as Record<string, unknown>;
      if (typeof tierMap.default !== "string" || tierMap.default.length === 0) {
        errors.push(`configs.${name}.personas.${slug}.default MUST be a non-empty string`);
      }
      for (const [key, value] of Object.entries(tierMap)) {
        if (key === "default") continue;
        if (!/^\d+$/u.test(key)) {
          errors.push(`configs.${name}.personas.${slug} has invalid tier key ${key}`);
        } else if (typeof value !== "string" || value.length === 0) {
          errors.push(`configs.${name}.personas.${slug}.${key} MUST be a non-empty string`);
        }
      }
    }
  }
  return errors;
}

/** Reads `runner.cursor.model_escalation.config` from pancreator.yaml when present. */
export function readModelEscalationConfigFromPancreator(repoRoot: string): string | undefined {
  const cfgPath = path.join(repoRoot, "pancreator.yaml");
  if (!existsSync(cfgPath)) {
    return undefined;
  }
  const raw = readFileSync(cfgPath, "utf8");
  const blockMatch = /runner:\s*\n(?:\s+.+\n)*?\s+cursor:\s*\n(?:\s+.+\n)*?\s+model_escalation:\s*\n(?:\s+.+\n)*?\s+config:\s*(\S+)/u.exec(
    raw,
  );
  if (blockMatch?.[1] !== undefined) {
    return blockMatch[1].replace(/^["']|["']$/gu, "");
  }
  const flatMatch = /runner\.cursor\.model_escalation\.config:\s*(\S+)/u.exec(raw);
  return flatMatch?.[1]?.replace(/^["']|["']$/gu, "");
}

/** Resolves active config name: env > pancreator.yaml > file active_config. */
export function resolveActiveConfigName(
  fileConfig: ModelEscalationFileConfig,
  repoRoot: string,
): string {
  const envOverride = process.env.PAN_MODEL_ESCALATION_CONFIG?.trim();
  if (envOverride !== undefined && envOverride.length > 0) {
    return envOverride;
  }
  const yamlOverride = readModelEscalationConfigFromPancreator(repoRoot);
  if (yamlOverride !== undefined && yamlOverride.length > 0) {
    return yamlOverride;
  }
  return fileConfig.active_config;
}

export function parseModelEscalationFile(raw: string): ModelEscalationFileConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ModelEscalationConfigError(`Failed to parse pancreator-model-escalation.yaml: ${detail}`);
  }
  const structErrors = validateModelEscalationStructure(parsed);
  if (structErrors.length > 0) {
    throw new ModelEscalationConfigError(
      `pancreator-model-escalation.yaml failed schema validation: ${structErrors.join("; ")}`,
    );
  }
  return parsed as ModelEscalationFileConfig;
}

export function loadModelEscalationConfig(
  repoRoot: string,
  options?: { configPath?: string; activeConfigOverride?: string },
): LoadedModelEscalation {
  const filePath = options?.configPath ?? path.join(repoRoot, "pancreator-model-escalation.yaml");
  if (!existsSync(filePath)) {
    throw new ModelEscalationConfigError(
      `Model escalation config is required at ${filePath} when runner.cursor.invocation is sdk`,
    );
  }
  const fileConfig = parseModelEscalationFile(readFileSync(filePath, "utf8"));
  const activeConfigName =
    options?.activeConfigOverride?.trim() ||
    resolveActiveConfigName(fileConfig, repoRoot);
  const config = fileConfig.configs[activeConfigName];
  if (config === undefined) {
    const available = Object.keys(fileConfig.configs).sort().join(", ");
    throw new ModelEscalationConfigError(
      `Active escalation config "${activeConfigName}" is not defined; available configs: ${available}`,
    );
  }
  return { activeConfigName, config, filePath };
}

function numericTierKeys(persona: PersonaEscalationTiers): number[] {
  return Object.keys(persona)
    .filter((key) => key !== "default" && /^\d+$/u.test(key))
    .map((key) => Number(key))
    .sort((a, b) => a - b);
}

function tierModelAtKey(persona: PersonaEscalationTiers, key: number): string {
  const raw = persona[String(key)] ?? persona[key as unknown as string];
  if (typeof raw === "string" && raw.length > 0) {
    return raw;
  }
  return persona.default;
}

/** Returns the effective model for a persona slug and stage invocation index. */
export function resolveEffectiveModel(
  loaded: LoadedModelEscalation,
  personaSlug: string,
  stageInvocationIndex: number,
): { model: string; usedDefaultTier: boolean; missingPersona: boolean } {
  const persona = loaded.config.personas[personaSlug];
  if (persona === undefined) {
    return { model: "auto", usedDefaultTier: false, missingPersona: true };
  }
  const keys = numericTierKeys(persona);
  const applicable = keys.filter((key) => key <= stageInvocationIndex);
  if (applicable.length === 0) {
    return { model: persona.default, usedDefaultTier: true, missingPersona: false };
  }
  const greatest = Math.max(...applicable);
  return {
    model: tierModelAtKey(persona, greatest),
    usedDefaultTier: false,
    missingPersona: false,
  };
}

/** Builds the model-issue fallback chain excluding the primary model already attempted. */
export function buildFallbackChain(
  loaded: LoadedModelEscalation,
  personaSlug: string,
  stageInvocationIndex: number,
  primaryModel: string,
): string[] {
  const persona = loaded.config.personas[personaSlug];
  if (persona === undefined) {
    return primaryModel === "auto" ? [] : ["auto"];
  }
  const attempted = new Set<string>([primaryModel]);
  const chain: string[] = [];
  const keys = numericTierKeys(persona);

  for (const key of keys.filter((k) => k < stageInvocationIndex).sort((a, b) => b - a)) {
    const model = tierModelAtKey(persona, key);
    if (!attempted.has(model)) {
      chain.push(model);
      attempted.add(model);
    }
  }
  if (!attempted.has(persona.default)) {
    chain.push(persona.default);
    attempted.add(persona.default);
  }
  for (const key of keys.filter((k) => k > stageInvocationIndex).sort((a, b) => a - b)) {
    const model = tierModelAtKey(persona, key);
    if (!attempted.has(model)) {
      chain.push(model);
      attempted.add(model);
    }
  }
  if (!attempted.has("auto")) {
    chain.push("auto");
  }
  return chain;
}

/** Classifies transport failures caused by model selection or capacity issues. */
export function isModelIssue(result: CursorSdkInvokeResult): boolean {
  if (result.missingArtifacts !== undefined && result.missingArtifacts.length > 0) {
    return false;
  }
  if (result.status !== "error" || result.errorMessage === undefined) {
    return false;
  }
  const message = result.errorMessage;
  return MODEL_ISSUE_PATTERNS.some((pattern) => pattern.test(message));
}

export interface EscalationObservability {
  active_config: string;
  persona_slug: string;
  stage_invocation_index: number;
  resolved_model: string;
  full_model_string: string;
  fallback_model?: string;
  fallback_reason?: string;
  outcome?: "success" | "chain_exhausted";
}
