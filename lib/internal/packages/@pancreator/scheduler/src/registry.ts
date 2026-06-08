import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import {
  AutomationNotFoundError,
  AutomationValidationError,
  InvalidAutomationIdError,
} from "./errors.js";
import {
  assertAutomationPathInRegistry,
  assertSafeAutomationId,
  automationFilePath,
  defaultAutomationsDir,
} from "./paths.js";
import {
  toAutomationSummary,
  validateAutomationDocument,
  type AutomationRecord,
  type AutomationSummary,
} from "./schema.js";

/** Materializes `.pan/automations/` with `.gitkeep` when absent. */
export async function ensureAutomationsDir(repoRoot: string): Promise<string> {
  const dir = defaultAutomationsDir(repoRoot);
  await fsp.mkdir(dir, { recursive: true });
  const gitkeep = path.join(dir, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    await fsp.writeFile(gitkeep, "", "utf8");
  }
  return dir;
}

async function readAutomationFile(filePath: string, repoRoot: string): Promise<AutomationRecord> {
  assertAutomationPathInRegistry(repoRoot, filePath);
  const raw = await fsp.readFile(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    throw new AutomationValidationError([`${path.basename(filePath)}: invalid YAML`]);
  }
  return validateAutomationDocument(parsed);
}

async function listYamlFiles(repoRoot: string): Promise<string[]> {
  const dir = await ensureAutomationsDir(repoRoot);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => path.join(dir, entry.name));
}

/** Lists all validated automation summaries. */
export async function listAutomations(repoRoot: string): Promise<AutomationSummary[]> {
  const files = await listYamlFiles(repoRoot);
  const summaries: AutomationSummary[] = [];

  for (const filePath of files) {
    const record = await readAutomationFile(filePath, repoRoot);
    summaries.push(toAutomationSummary(record));
  }

  return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

/** Lists enabled automations for due evaluation. */
export async function listDueAutomations(repoRoot: string): Promise<AutomationSummary[]> {
  const all = await listAutomations(repoRoot);
  return all.filter((summary) => summary.enabled);
}

/** Reads a single automation record by id. */
export async function getAutomation(repoRoot: string, automationId: string): Promise<AutomationRecord> {
  assertSafeAutomationId(automationId);
  const filePath = automationFilePath(repoRoot, automationId);
  if (!fs.existsSync(filePath)) {
    throw new AutomationNotFoundError(`Automation ${automationId} was not found.`);
  }
  return readAutomationFile(filePath, repoRoot);
}

/** Writes a new automation YAML file. */
export async function createAutomation(
  repoRoot: string,
  record: unknown,
): Promise<AutomationRecord> {
  const validated = validateAutomationDocument(record);
  assertSafeAutomationId(validated.id);

  await ensureAutomationsDir(repoRoot);
  const filePath = automationFilePath(repoRoot, validated.id);
  if (fs.existsSync(filePath)) {
    throw new AutomationValidationError([`id: automation ${validated.id} already exists`]);
  }

  assertAutomationPathInRegistry(repoRoot, filePath);
  await fsp.writeFile(filePath, stringifyYaml(validated), "utf8");
  return validated;
}

/** Overwrites an existing automation YAML file. */
export async function updateAutomation(
  repoRoot: string,
  record: unknown,
): Promise<AutomationRecord> {
  const validated = validateAutomationDocument(record);
  assertSafeAutomationId(validated.id);

  const filePath = automationFilePath(repoRoot, validated.id);
  if (!fs.existsSync(filePath)) {
    throw new AutomationNotFoundError(`Automation ${validated.id} was not found.`);
  }

  assertAutomationPathInRegistry(repoRoot, filePath);
  await fsp.writeFile(filePath, stringifyYaml(validated), "utf8");
  return validated;
}

/** Deletes an automation YAML file. */
export async function deleteAutomation(repoRoot: string, automationId: string): Promise<void> {
  assertSafeAutomationId(automationId);
  const filePath = automationFilePath(repoRoot, automationId);
  if (!fs.existsSync(filePath)) {
    throw new AutomationNotFoundError(`Automation ${automationId} was not found.`);
  }
  assertAutomationPathInRegistry(repoRoot, filePath);
  await fsp.unlink(filePath);
}

export {
  AutomationNotFoundError,
  AutomationValidationError,
  InvalidAutomationIdError,
};
