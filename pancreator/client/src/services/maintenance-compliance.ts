import fs from "node:fs";
import path from "node:path";
import { findRepoRoot } from "./repo-paths";

export type ComplianceSeverity = "high" | "medium" | "low";

export type ComplianceDescriptorSummary = {
  id: string;
  severity: ComplianceSeverity;
  triggerModes: string[];
  descriptorPath: string;
};

export type ComplianceRunResult = {
  exitCode: number;
  report: Record<string, unknown>;
};

const SHELL_METACHAR_PATTERN = /[;&|`$()<>\n\r\0]/u;

const DESCRIPTOR_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/u;

type RunComplianceModule = {
  runCompliance: (
    filterId?: string,
    options?: { runId?: string },
  ) => Promise<{ exitCode: number; report: Record<string, unknown> }>;
  discoverDescriptorFiles: (filterId?: string) => string[];
};

async function loadComplianceRunner(): Promise<RunComplianceModule> {
  // run-compliance.mjs is a repository tool without TypeScript declarations.
  return import("../../../lib/internal/tools/compliance/run-compliance.mjs" as string) as Promise<RunComplianceModule>;
}

export function validateDescriptorId(descriptorId: string): { error: string } | null {
  const trimmed = descriptorId.trim();
  if (trimmed.length === 0) {
    return { error: "Descriptor id is required" };
  }
  if (SHELL_METACHAR_PATTERN.test(trimmed)) {
    return { error: "Shell metacharacters are not allowed" };
  }
  if (!DESCRIPTOR_ID_PATTERN.test(trimmed)) {
    return { error: `Descriptor id "${trimmed}" is invalid` };
  }
  return null;
}

export function parseDescriptorMetadata(
  raw: string,
  descriptorPath: string,
): ComplianceDescriptorSummary | null {
  const idMatch = raw.match(/^id:\s*"?([^"\n]+)"?\s*$/mu);
  const severityMatch = raw.match(/^severity:\s*"?([^"\n]+)"?\s*$/mu);
  if (!idMatch || !severityMatch) {
    return null;
  }
  const severity = severityMatch[1].trim() as ComplianceSeverity;
  if (severity !== "high" && severity !== "medium" && severity !== "low") {
    return null;
  }
  const triggerModes: string[] = [];
  const triggerBlock = raw.match(/^trigger_modes:\s*\n((?:\s+-\s+.+\n?)*)/mu);
  if (triggerBlock) {
    for (const line of triggerBlock[1].split("\n")) {
      const modeMatch = line.match(/^\s+-\s+(.+)\s*$/u);
      if (modeMatch) {
        triggerModes.push(modeMatch[1].trim());
      }
    }
  }
  return {
    id: idMatch[1].trim(),
    severity,
    triggerModes,
    descriptorPath,
  };
}

export async function listComplianceDescriptors(
  repoRoot: string = findRepoRoot(),
): Promise<ComplianceDescriptorSummary[]> {
  const { discoverDescriptorFiles } = await loadComplianceRunner();
  const descriptorPaths = discoverDescriptorFiles();
  const summaries: ComplianceDescriptorSummary[] = [];

  for (const absPath of descriptorPaths) {
    const rel = path.relative(repoRoot, absPath).replace(/\\/g, "/");
    const raw = fs.readFileSync(absPath, "utf8");
    const parsed = parseDescriptorMetadata(raw, rel);
    if (parsed !== null) {
      summaries.push(parsed);
    }
  }

  return summaries.sort((left, right) => left.id.localeCompare(right.id));
}

export async function isKnownDescriptorId(
  descriptorId: string,
  repoRoot: string = findRepoRoot(),
): Promise<boolean> {
  const descriptors = await listComplianceDescriptors(repoRoot);
  return descriptors.some((descriptor) => descriptor.id === descriptorId);
}

export async function executeComplianceRun(
  descriptorId?: string,
  repoRoot: string = findRepoRoot(),
): Promise<ComplianceRunResult> {
  void repoRoot;
  const { runCompliance } = await loadComplianceRunner();
  const { exitCode, report } = await runCompliance(descriptorId);
  return { exitCode, report };
}
