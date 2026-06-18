import path from "node:path";

import { quoteJsonString, resolveProjectPath } from "@pancreator/core";

import { AutomationPathError, InvalidAutomationIdError, SchedulerPathError } from "./errors.js";

/** Returns `.pan/automations` under the configured project root. */
export function defaultAutomationsDir(repoRoot: string): string {
  return resolveProjectPath(repoRoot, ".pan", "automations");
}

/** Rejects automation identifiers that would escape the automations directory. */
export function assertSafeAutomationId(automationId: string): void {
  if (
    automationId === "" ||
    automationId.includes("/") ||
    automationId.includes("\\") ||
    automationId.includes("..")
  ) {
    throw new InvalidAutomationIdError(
      `Automation id ${quoteJsonString(automationId)} is not safe for a registry file name.`,
    );
  }
}

/** Resolves the YAML path for `automationId`. */
export function automationFilePath(repoRoot: string, automationId: string): string {
  assertSafeAutomationId(automationId);
  return path.join(defaultAutomationsDir(repoRoot), `${automationId}.yaml`);
}

/** Ensures `filePath` resolves inside `repoRoot/.pan/automations`. */
export function assertAutomationPathInRegistry(repoRoot: string, filePath: string): void {
  const automationsDir = defaultAutomationsDir(repoRoot);
  const resolved = path.resolve(filePath);
  const rel = path.relative(automationsDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new AutomationPathError(
      `Automation path ${resolved} is outside automations directory ${automationsDir}.`,
    );
  }
}

/** Returns `.pan/scheduler` under the configured project root. */
export function defaultSchedulerDir(repoRoot: string): string {
  return resolveProjectPath(repoRoot, ".pan", "scheduler");
}

/** Returns `.pan/scheduler/runs` under the configured project root. */
export function defaultRunsDir(repoRoot: string): string {
  return path.join(defaultSchedulerDir(repoRoot), "runs");
}

/** Returns `.pan/scheduler/locks` under the configured project root. */
export function defaultLocksDir(repoRoot: string): string {
  return path.join(defaultSchedulerDir(repoRoot), "locks");
}

/** Resolves the JSONL run-log path for `automationId`. */
export function runLogFilePath(repoRoot: string, automationId: string): string {
  assertSafeAutomationId(automationId);
  return path.join(defaultRunsDir(repoRoot), `${automationId}.jsonl`);
}

/** Resolves the lock metadata path for `automationId`. */
export function lockFilePath(repoRoot: string, automationId: string): string {
  assertSafeAutomationId(automationId);
  return path.join(defaultLocksDir(repoRoot), `${automationId}.json`);
}

/** Ensures `filePath` resolves inside `repoRoot/.pan/scheduler/`. */
export function assertPathInScheduler(repoRoot: string, filePath: string): void {
  const schedulerDir = defaultSchedulerDir(repoRoot);
  const resolved = path.resolve(filePath);
  const rel = path.relative(schedulerDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new SchedulerPathError(
      `Scheduler path ${resolved} is outside scheduler directory ${schedulerDir}.`,
    );
  }
}
