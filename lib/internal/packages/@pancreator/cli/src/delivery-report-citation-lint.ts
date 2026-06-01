import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveRepoPath } from "@pancreator/core";

export interface CitationViolation {
  rule: string;
  line: number;
}

export interface CitationLintResult {
  ok: boolean;
  violations: CitationViolation[];
}

interface CitationLintModule {
  lintDeliveryReportCitations: (text: string) => CitationLintResult;
  formatDeliveryReportCitationError: (text: string, repoRelPath: string) => string;
}

let cachedModule: CitationLintModule | null = null;

async function loadCitationLintModule(repoRoot: string): Promise<CitationLintModule> {
  if (cachedModule !== null) {
    return cachedModule;
  }
  const modulePath = pathToFileURL(
    resolveRepoPath(repoRoot, "lib/internal/tools/markdown-citation-lint.mjs"),
  ).href;
  cachedModule = (await import(modulePath)) as CitationLintModule;
  return cachedModule;
}

export async function assertDeliveryReportCitationFormat(
  repoRoot: string,
  artifactRel: string,
): Promise<void> {
  if (!artifactRel.endsWith("delivery-report.md")) {
    return;
  }
  const abs = resolveRepoPath(repoRoot, artifactRel);
  const text = await readFile(abs, "utf8");
  const mod = await loadCitationLintModule(repoRoot);
  const message = mod.formatDeliveryReportCitationError(text, artifactRel);
  if (message.length > 0) {
    throw new Error(message);
  }
}

/** @internal Test-only reset for module cache. */
export function resetCitationLintModuleCacheForTests(): void {
  cachedModule = null;
}
