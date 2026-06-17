import fsp from "node:fs/promises";
import path from "node:path";
import {
  createAutomation,
  deleteAutomation,
  formatScheduleLabel,
  listAutomations,
  listDueAutomations,
  toAutomationSummary,
  updateAutomation,
  type AutomationRecord,
  type AutomationSummary,
} from "@pancreator/scheduler";
import { findRepoRoot } from "./repo-paths";

export type CronPreset = {
  id: string;
  label: string;
  cron: string;
};

export const CRON_PRESETS: CronPreset[] = [
  { id: "hourly", label: "Hourly", cron: "0 * * * *" },
  { id: "daily", label: "Daily at midnight", cron: "0 0 * * *" },
  { id: "weekly", label: "Weekly on Monday", cron: "0 0 * * 1" },
  { id: "custom", label: "Custom", cron: "" },
];

export type { AutomationRecord, AutomationSummary };

export function deriveAutomationId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function defaultAgentAutomationDraft(name = ""): AutomationRecord {
  const id = deriveAutomationId(name);
  return {
    schemaVersion: 1,
    id,
    name,
    enabled: true,
    schedule: CRON_PRESETS[0]?.cron ?? "0 * * * *",
    trigger: {
      kind: "agent",
      persona: "",
      prompt: "",
    },
    policy: {
      maxConcurrent: 1,
      timeoutMinutes: 60,
    },
  };
}

export async function discoverPersonaSlugs(repoRoot: string = findRepoRoot()): Promise<string[]> {
  const personasDir = path.join(repoRoot, "lib", "personas");
  const entries = await fsp.readdir(personasDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/u, ""))
    .sort((left, right) => left.localeCompare(right));
}

export async function loadAutomationSummaries(
  repoRoot: string = findRepoRoot(),
): Promise<AutomationSummary[]> {
  return listAutomations(repoRoot);
}

export async function loadDueAutomationSummaries(
  repoRoot: string = findRepoRoot(),
): Promise<AutomationSummary[]> {
  return listDueAutomations(repoRoot);
}

export async function saveAutomationCreate(
  record: AutomationRecord,
  repoRoot: string = findRepoRoot(),
): Promise<AutomationSummary> {
  const created = await createAutomation(repoRoot, record);
  return toAutomationSummary(created);
}

export async function saveAutomationUpdate(
  record: AutomationRecord,
  repoRoot: string = findRepoRoot(),
): Promise<AutomationSummary> {
  const updated = await updateAutomation(repoRoot, record);
  return toAutomationSummary(updated);
}

export async function removeAutomation(
  automationId: string,
  repoRoot: string = findRepoRoot(),
): Promise<void> {
  await deleteAutomation(repoRoot, automationId);
}

export function humanScheduleLabel(schedule: string): string {
  return formatScheduleLabel(schedule);
}
