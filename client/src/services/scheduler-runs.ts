import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { asTaskId } from "@pancreator/core";
import { FsInterventionStore } from "@pancreator/intervention";
import { parsePersonaMarkdown } from "@pancreator/persona";
import { CursorRunner } from "@pancreator/runner-cursor";
import {
  AutomationNotFoundError,
  InvalidAutomationIdError,
  tickAutomations,
  type RunRecord,
  type TickExecutors,
} from "@pancreator/scheduler";

import { findRepoRoot } from "@/services/repo-paths";

export type { RunRecord };

async function resolvePersonaInput(repoRoot: string, personaId: string) {
  const rel = path.posix.join("lib", "personas", `${personaId}.md`);
  const abs = path.join(repoRoot, rel);
  const raw = await readFile(abs, "utf8");
  const { spec } = parsePersonaMarkdown(raw);
  return {
    name: spec.name,
    description: spec.description,
    model: spec.model,
    permissionMode: spec.permissionMode,
    tools: spec.tools,
    disallowedTools: spec.disallowedTools,
    mcpServers: spec.mcpServers,
    maxTurns: spec.maxTurns,
    skills: spec.skills,
    isolation: spec.isolation,
    memory: spec.memory,
    effort: spec.effort,
    color: spec.color,
    metadata: spec.metadata,
  };
}

function createTickExecutors(repoRoot: string): TickExecutors {
  const runner = new CursorRunner({
    invocation: "manual",
    repoRoot,
    cwd: repoRoot,
    apiKey: process.env.CURSOR_API_KEY,
  });
  const interventionStore = new FsInterventionStore(repoRoot);

  return {
    dispatchAgent: async ({ automation, persona, prompt, runId }) => {
      const personaInput = await resolvePersonaInput(repoRoot, persona);
      const envelope = await runner.invoke({
        persona: personaInput,
        message: prompt,
        ledger: {
          taskId: `${automation.id}-${runId}`,
          pipelineId: "scheduler",
          stageId: "tick",
          featureId: automation.id,
        },
      });
      const taskId = envelope.resolved.ledger?.taskId ?? `${automation.id}-${runId}`;
      await interventionStore.appendRecord(asTaskId(taskId), {
        taskId: asTaskId(taskId),
        command: "pause",
        atIso: new Date().toISOString(),
      });
      const ok = envelope.sdkResult?.status !== "error";
      return {
        ok,
        stdoutSummary: envelope.sdkResult?.resultText ?? envelope.userMessage,
        stderrSummary: envelope.sdkResult?.errorMessage ?? "",
        taskId,
      };
    },
    dispatchPan: async ({ subcommand }) => {
      const args = ["-w", "exec", "pan", ...subcommand.trim().split(/\s+/u)];
      const result = spawnSync("pnpm", args, {
        cwd: repoRoot,
        encoding: "utf8",
        shell: false,
      });
      return {
        ok: result.status === 0,
        stdoutSummary: result.stdout?.trim() ?? "",
        stderrSummary: result.stderr?.trim() ?? "",
      };
    },
  };
}

export async function triggerManualAutomationRun(automationId: string): Promise<{
  outcomes: { automationId: string; runId: string; status: string }[];
}> {
  const repoRoot = findRepoRoot();
  const outcomes = await tickAutomations(repoRoot, {
    automationId,
    manual: true,
    executors: createTickExecutors(repoRoot),
  });
  return { outcomes };
}

export {
  AutomationNotFoundError,
  InvalidAutomationIdError,
};
