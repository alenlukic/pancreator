import { projectRootAbs, quoteJsonString, resolveModelEscalationYamlPath } from "@pancreator/core";
import { loadModelEscalationConfig, type LoadedModelEscalation } from "@pancreator/runner-cursor";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type PersonaModelWrittenEntry = {
  path: string;
  action: "write" | "would_write";
};

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/").replace(/\/+/g, "/");
}

function projectPath(projectPrefix: string, relPath: string): string {
  if (projectPrefix === ".") {
    return relPath;
  }
  return posixJoin(projectPrefix, relPath);
}

function yamlQuoteModelValue(value: string): string {
  // Bracket qualifiers (e.g. composer-2.5[fast=false]) stay unquoted like lib/personas/*.md.
  if (/[:#{}&*!|>'"%@`\n]/u.test(value) || value.startsWith(" ") || value.endsWith(" ")) {
    return quoteJsonString(value);
  }
  return value;
}

/** Updates only the `model:` frontmatter line; preserves the rest of the file verbatim. */
export function setPersonaFrontmatterModel(
  raw: string,
  model: string,
): { content: string; changed: boolean; previousModel?: string } {
  const fence = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw);
  if (!fence) {
    throw new Error("Missing YAML frontmatter");
  }
  const frontmatter = fence[1]!;
  const modelLineRe = /^model:\s*(.*)$/mu;
  const modelMatch = modelLineRe.exec(frontmatter);
  const previousModel = modelMatch?.[1]?.trim().replace(/^["']|["']$/gu, "");
  const newLine = `model: ${yamlQuoteModelValue(model)}`;
  let nextFrontmatter: string;
  if (modelMatch) {
    nextFrontmatter = frontmatter.replace(modelLineRe, newLine);
  } else {
    const nameMatch = /^name:\s*.*/mu.exec(frontmatter);
    if (nameMatch) {
      nextFrontmatter = frontmatter.replace(nameMatch[0], `${nameMatch[0]}\n${newLine}`);
    } else {
      nextFrontmatter = `${newLine}\n${frontmatter}`;
    }
  }
  const changed = nextFrontmatter !== frontmatter;
  const content = changed
    ? raw.replace(fence[0], `---\n${nextFrontmatter}\n---`)
    : raw;
  return { content, changed, previousModel };
}

export interface SyncPersonaModelsResult {
  activeConfigName?: string;
  escalationConfigPath?: string;
  written: PersonaModelWrittenEntry[];
}

function tryLoadEscalation(harnessRoot: string): LoadedModelEscalation | undefined {
  if (resolveModelEscalationYamlPath(harnessRoot) === undefined) {
    return undefined;
  }
  return loadModelEscalationConfig(harnessRoot);
}

/**
 * Applies `default` tier models from the active escalation config onto matching
 * `lib/personas/<slug>.md` files. Personas absent from the active config are left unchanged.
 */
export function syncPersonaModelsFromEscalation(
  harnessRoot: string,
  projectRootRel: string,
  options: { dryRun?: boolean } = {},
): SyncPersonaModelsResult {
  const dryRun = options.dryRun ?? false;
  const loaded = tryLoadEscalation(harnessRoot);
  if (loaded === undefined) {
    return { written: [] };
  }

  const projectRoot = projectRootAbs(harnessRoot, projectRootRel);
  const personasDir = path.join(projectRoot, "lib", "personas");
  if (!existsSync(personasDir)) {
    return {
      activeConfigName: loaded.activeConfigName,
      escalationConfigPath: loaded.filePath,
      written: [],
    };
  }

  const written: PersonaModelWrittenEntry[] = [];
  for (const file of readdirSync(personasDir)
    .filter((name) => name.endsWith(".md"))
    .sort()) {
    const slug = file.replace(/\.md$/u, "");
    const tiers = loaded.config.personas[slug];
    if (tiers === undefined) {
      continue;
    }
    const model = tiers.default;
    if (typeof model !== "string" || model.length === 0) {
      continue;
    }

    const absPath = path.join(personasDir, file);
    const raw = readFileSync(absPath, "utf8");
    const { content, changed } = setPersonaFrontmatterModel(raw, model);
    if (!changed) {
      continue;
    }

    const relPath = projectPath(projectRootRel, posixJoin("lib", "personas", file));
    if (!dryRun) {
      writeFileSync(absPath, content, "utf8");
    }
    written.push({ path: relPath, action: dryRun ? "would_write" : "write" });
  }

  return {
    activeConfigName: loaded.activeConfigName,
    escalationConfigPath: loaded.filePath,
    written,
  };
}
