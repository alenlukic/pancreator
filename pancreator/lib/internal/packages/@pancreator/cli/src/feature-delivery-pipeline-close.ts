import { resolveRepoPath } from "@pancreator/core";
import { rfc3339UtcMs } from "@pancreator/run-logger";
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { panWorkMarkdownMeta, wrapPanWorkMarkdown } from "./pan-work-artifact.js";
import { operatorVerificationRel } from "./operator-verification.js";
import { deliveryReportRel, durableFeatureIndexRel, workflowHealthRel } from "./feature-delivery-stage-artifacts.js";
import { readWorkflowHealthSummary } from "./workflow-health.js";

export const PIPELINE_CLOSE_FILENAME = "pipeline-close.md";

export interface PipelineCloseAdvanceEntry {
  atIso: string;
  kind: "advance" | "repair" | "close" | "reopen";
  from: string;
  to: string;
  event: string;
  artifact: string;
  reason?: string;
}

export interface PipelineCloseState {
  taskId: string;
  featureId: string;
  pipelineId: string;
  status: string;
  currentStage: string;
  source: { inboxPath: string };
  artifacts: { runDir: string };
  nextHumanAction?: string;
  advanceHistory?: PipelineCloseAdvanceEntry[];
}

export function pipelineCloseRel(state: Pick<PipelineCloseState, "artifacts">): string {
  return path.posix.join(state.artifacts.runDir, PIPELINE_CLOSE_FILENAME);
}

function formatStageHistoryRows(history: PipelineCloseAdvanceEntry[] | undefined): string {
  const advances = (history ?? []).filter((entry) => entry.kind === "advance");
  if (advances.length === 0) {
    return "| — | — | — |\n";
  }
  return advances
    .map((entry) => `| ${entry.from} → ${entry.to} | ${entry.event} | \`${entry.artifact}\` |`)
    .join("\n");
}

function readIndexFollowups(repoRoot: string, featureId: string): string[] {
  const indexRel = durableFeatureIndexRel(featureId);
  const indexAbs = resolveRepoPath(repoRoot, indexRel);
  if (!existsSync(indexAbs)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(indexAbs, "utf8")) as {
      open_followups?: Array<{ id?: string; reason?: string; summary?: string }>;
    };
    const followups = parsed.open_followups ?? [];
    return followups.map((item) => {
      const label = item.id ?? item.summary ?? "follow-up";
      return item.reason ? `${label}: ${item.reason}` : label;
    });
  } catch {
    return [];
  }
}

export function renderPipelineCloseDoc(
  state: PipelineCloseState,
  repoRoot: string,
  now: Date,
): string {
  const reportRel = deliveryReportRel(state.artifacts.runDir);
  const indexRel = durableFeatureIndexRel(state.featureId);
  const verificationRel = operatorVerificationRel(state);
  const residual: string[] = [];

  if (state.status === "halted") {
    residual.push(`Run halted (${state.nextHumanAction ?? "see state.json"}).`);
  }
  const followups = readIndexFollowups(repoRoot, state.featureId);
  for (const item of followups) {
    residual.push(item);
  }
  const workflowHealth = readWorkflowHealthSummary(repoRoot, state.artifacts.runDir);
  if (workflowHealth !== null && workflowHealth.status !== "healthy") {
    residual.push(
      `Workflow health is ${workflowHealth.status}; see ${workflowHealthRel(state.artifacts.runDir)}.`,
    );
  }

  const residualSection =
    residual.length === 0
      ? "- None recorded; review delivery report and local diff before archival closure."
      : residual.map((line) => `- ${line}`).join("\n");

  const closeCmd = `pnpm -w exec pan close-artifacts ${state.taskId}`;

  return wrapPanWorkMarkdown(
    `# Pipeline close — ${state.featureId}

- Task id: \`${state.taskId}\`
- Feature id: \`${state.featureId}\`
- Pipeline: ${state.pipelineId}
- Status: \`${state.status}\` (stage \`${state.currentStage}\`)
- Run directory: \`${state.artifacts.runDir}\`
- Generated at (UTC): \`${rfc3339UtcMs(now)}\`

## Outcome

Feature-delivery reached \`${state.currentStage}\` with pipeline status \`${state.status}\`.
Source directive: \`${state.source.inboxPath}\`.

## Stage history

| Transition | Event | Artifact |
|---|---|---|
${formatStageHistoryRows(state.advanceHistory)}

## Residual issues

${residualSection}

## Operator next steps

- Read-only: inspect \`${reportRel}\`, \`${indexRel}\`, \`${verificationRel}\`, and the local diff.
- Read-only: execute acceptance criteria and manual test flows in \`${verificationRel}\` before archival when possible; reopen with \`pnpm -w exec pan reopen ${state.taskId}\` when verification fails after close.
- Read-only: review this file and update residual issues or next steps before archival when needed.
- When satisfied, run exactly once:

\`\`\`bash
${closeCmd}
\`\`\`

- No agent SHALL push or open a pull request; Q3 requires human audit of the local diff.
`,
    panWorkMarkdownMeta({
      artifact: "Pipeline close handoff",
      featureId: state.featureId,
      taskId: state.taskId,
      whyItMatters: "Summarizes stage history, residual issues, and the exact close-artifacts command for the librarian.",
      seeAlso: ["lib/memory/handbook/operator-output-contract.md"],
    }),
  );
}

export async function ensurePipelineCloseDoc(
  repoRoot: string,
  state: PipelineCloseState,
  now: Date,
): Promise<string> {
  const rel = pipelineCloseRel(state);
  const abs = resolveRepoPath(repoRoot, rel);
  if (existsSync(abs)) {
    return rel;
  }
  await writeFile(abs, renderPipelineCloseDoc(state, repoRoot, now), "utf8");
  return rel;
}
