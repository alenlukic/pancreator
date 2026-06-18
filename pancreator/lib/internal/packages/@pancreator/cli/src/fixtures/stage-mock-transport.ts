import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveRepoPath } from "@pancreator/core";
import type { CursorSdkTransport } from "@pancreator/runner-cursor";

const REMEDIATION_PERSONA = "pancreator-engineer";

export interface StageFixtureWrite {
  path: string;
  content: string;
}

export interface StageFixture {
  stage: string;
  taskId: string;
  featureId: string;
  runDir: string;
  handoffFile: string;
  stagePrompt: string;
  writesOnSuccess: StageFixtureWrite[];
  writesOnRemediation: StageFixtureWrite[];
}

async function applyWrites(repoRoot: string, writes: StageFixtureWrite[]): Promise<void> {
  for (const entry of writes) {
    const abs = resolveRepoPath(repoRoot, entry.path);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, entry.content, "utf8");
  }
}

function findMissing(repoRoot: string, required: readonly string[]): string[] {
  return required.filter((rel) => !existsSync(resolveRepoPath(repoRoot, rel)));
}

/** Deterministic SDK transport driven by JSON stage fixtures. */
export function createStageMockTransport(
  repoRoot: string,
  fixture: StageFixture,
): CursorSdkTransport {
  let remediationCalls = 0;

  return async (params) => {
    if (params.persona.name === REMEDIATION_PERSONA) {
      remediationCalls += 1;
      await applyWrites(repoRoot, fixture.writesOnRemediation);
    } else {
      await applyWrites(repoRoot, fixture.writesOnSuccess);
    }

    const required =
      params.requiredArtifactPaths ??
      (params.artifactPath !== undefined ? [params.artifactPath] : []);
    const missingArtifacts = findMissing(repoRoot, required);
    if (missingArtifacts.length > 0 && params.persona.name !== REMEDIATION_PERSONA) {
      return {
        status: "error",
        errorMessage: `Cursor SDK run finished but required artifacts are missing: ${missingArtifacts.join(", ")}`,
        missingArtifacts,
      };
    }

    return {
      status: "ok",
      resultText: `${params.persona.name}:ok:remediationCalls=${remediationCalls}`,
    };
  };
}
