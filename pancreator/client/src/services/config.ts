import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";

export type PersonaEscalationBadge = {
  persona: string;
  tierLabel: string;
};

export type RuntimeConfigSnapshot = {
  invocationMode: "sdk" | "manual" | "unknown";
  designStepsDefault: boolean;
  stageRemediation: boolean;
  sdkSampling: {
    enabled: boolean;
    ratePercent: number | null;
    scope: string | null;
  };
  activeEscalationConfig: string;
  personaEscalationBadges: PersonaEscalationBadge[];
};

function readYamlScalar(yaml: string, keyPath: string[]): string | null {
  const lines = yaml.split("\n");
  let depth = 0;
  const stack: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/gu, "  ");
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }

    const indent = line.search(/\S/u);
    const content = line.trim();
    const colonIndex = content.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = content.slice(0, colonIndex).trim();
    const value = content.slice(colonIndex + 1).trim();

    while (stack.length > 0 && indent <= depth) {
      stack.pop();
      depth -= 2;
    }

    if (value.length === 0) {
      stack.push(key);
      depth = indent;
      continue;
    }

    const pathKeys = [...stack, key];
    if (pathKeys.length === keyPath.length && pathKeys.every((segment, index) => segment === keyPath[index])) {
      return value.replace(/^['"]|['"]$/gu, "");
    }
  }

  return null;
}

function readBooleanScalar(yaml: string, keyPath: string[], fallback = false): boolean {
  const value = readYamlScalar(yaml, keyPath);
  if (value === null) {
    return fallback;
  }
  return value === "true";
}

function readNumberScalar(yaml: string, keyPath: string[]): number | null {
  const value = readYamlScalar(yaml, keyPath);
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePersonaEscalationBadges(yaml: string): PersonaEscalationBadge[] {
  const activeConfig = readYamlScalar(yaml, ["active_config"]) ?? "default";
  const badges: PersonaEscalationBadge[] = [];
  const lines = yaml.split("\n");
  let activeConfigBlock: string | null = null;
  let inPersonas = false;
  let personasIndent = -1;
  let currentPersona: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/gu, "  ");
    if (line.trim().length === 0 || line.trim().startsWith("#")) {
      continue;
    }

    const indent = line.search(/\S/u);
    const content = line.trim();

    const configMatch = content.match(/^([a-z0-9_-]+):$/u);
    if (configMatch !== null && indent === 2) {
      activeConfigBlock = configMatch[1] ?? null;
      inPersonas = false;
      personasIndent = -1;
      currentPersona = null;
      continue;
    }

    if (activeConfigBlock !== activeConfig) {
      inPersonas = false;
      currentPersona = null;
      continue;
    }

    if (content === "personas:") {
      inPersonas = true;
      personasIndent = indent;
      currentPersona = null;
      continue;
    }

    if (!inPersonas) {
      continue;
    }

    if (indent <= personasIndent && content !== "personas:") {
      inPersonas = false;
      currentPersona = null;
      continue;
    }

    const personaMatch = content.match(/^([a-z0-9-]+):$/u);
    if (personaMatch !== null && indent === personasIndent + 2) {
      currentPersona = personaMatch[1] ?? null;
      continue;
    }

    if (currentPersona !== null && content.startsWith("default:")) {
      const tierLabel = content.slice("default:".length).trim().replace(/^['"]|['"]$/gu, "");
      if (tierLabel.length > 0) {
        badges.push({ persona: currentPersona, tierLabel });
      }
    }
  }

  return badges;
}

export async function loadRuntimeConfig(repoRoot: string = findRepoRoot()): Promise<RuntimeConfigSnapshot> {
  const pancreatorYaml = await fsp.readFile(path.join(repoRoot, "pancreator.yaml"), "utf8");
  const escalationPath = path.join(repoRoot, "pancreator-model-escalation.yaml");
  const escalationYaml = fs.existsSync(escalationPath)
    ? await fsp.readFile(escalationPath, "utf8")
    : "";

  const invocationRaw = readYamlScalar(pancreatorYaml, ["runner", "cursor", "invocation"]);
  const invocationMode =
    invocationRaw === "sdk" || invocationRaw === "manual" ? invocationRaw : "unknown";

  const designStepsFromFeatureDelivery = readBooleanScalar(
    pancreatorYaml,
    ["feature_delivery", "design_steps"],
    false,
  );

  return {
    invocationMode,
    designStepsDefault: designStepsFromFeatureDelivery,
    stageRemediation: readBooleanScalar(pancreatorYaml, ["runner", "cursor", "stage_remediation"], false),
    sdkSampling: {
      enabled: readBooleanScalar(pancreatorYaml, ["runner", "cursor", "sdkSampling", "enabled"], false),
      ratePercent: readNumberScalar(pancreatorYaml, ["runner", "cursor", "sdkSampling", "ratePercent"]),
      scope: readYamlScalar(pancreatorYaml, ["runner", "cursor", "sdkSampling", "scope"]),
    },
    activeEscalationConfig: readYamlScalar(escalationYaml, ["active_config"]) ?? "unknown",
    personaEscalationBadges: parsePersonaEscalationBadges(escalationYaml),
  };
}
