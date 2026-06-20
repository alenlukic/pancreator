import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { asTaskId, projectRootAbs, resolveProjectPath } from "@pancreator/core";
import { FsInterventionStore } from "@pancreator/intervention";
import { parsePersonaMarkdown } from "@pancreator/persona";
import {
  CursorRunner,
  loadRepoEnv,
  prepareCursorRunnerEnvironment,
  readCursorInvocationMode,
  type RunnerPersonaInput,
} from "@pancreator/runner-cursor";

import type { TickDispatchResult, TickExecutors } from "./tick.js";

export const SCHEDULER_DRY_RUN_MESSAGE =
  "Dry-run mode (runner.cursor.invocation: manual). No agent or pan subcommand was executed. Set runner.cursor.invocation: sdk in pancreator.yaml to run automations live.";

export type CreateSchedulerTickExecutorsOptions = {
  invocation?: "manual" | "sdk";
  prepareEnvironment?: (repoRoot: string) => void;
};

async function resolvePersonaInput(repoRoot: string, personaId: string): Promise<RunnerPersonaInput> {
  const rel = path.posix.join("lib", "personas", `${personaId}.md`);
  const abs = resolveProjectPath(repoRoot, rel);
  const raw = await readFile(abs, "utf8");
  const { spec } = parsePersonaMarkdown(raw);
  if (spec.name !== personaId) {
    throw new Error(`Persona file ${rel} frontmatter name "${spec.name}" does not match id "${personaId}".`);
  }
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

function evaluateAgentDispatch(envelope: {
  dryRun: boolean;
  userMessage: string;
  sdkResult?: { status: "ok" | "error"; resultText?: string; errorMessage?: string };
}): TickDispatchResult {
  if (envelope.dryRun) {
    return {
      ok: false,
      executionMode: "dry-run",
      stdoutSummary: envelope.userMessage,
      stderrSummary: SCHEDULER_DRY_RUN_MESSAGE,
    };
  }
  const ok = envelope.sdkResult?.status === "ok";
  return {
    ok,
    executionMode: "live",
    stdoutSummary: envelope.sdkResult?.resultText ?? "",
    stderrSummary: envelope.sdkResult?.errorMessage ?? "",
  };
}

/** Builds scheduler tick executors that honor `runner.cursor.invocation` from `pancreator.yaml`. */
export async function createSchedulerTickExecutors(
  harnessRoot: string,
  options: CreateSchedulerTickExecutorsOptions = {},
): Promise<TickExecutors> {
  const prepareEnvironment = options.prepareEnvironment ?? prepareCursorRunnerEnvironment;
  prepareEnvironment(harnessRoot);

  const invocation = options.invocation ?? readCursorInvocationMode(harnessRoot);
  const projectRoot = projectRootAbs(harnessRoot);
  const runner = new CursorRunner({
    invocation,
    repoRoot: harnessRoot,
    cwd: projectRoot,
    apiKey: process.env.CURSOR_API_KEY,
  });
  const interventionStore = new FsInterventionStore(harnessRoot);

  return {
    dispatchAgent: async ({ automation, persona, prompt, runId }) => {
      const personaInput = await resolvePersonaInput(harnessRoot, persona);
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
      const dispatch = evaluateAgentDispatch(envelope);
      if (dispatch.executionMode === "live") {
        await interventionStore.appendRecord(asTaskId(taskId), {
          taskId: asTaskId(taskId),
          command: "pause",
          atIso: new Date().toISOString(),
        });
      }
      return { ...dispatch, taskId };
    },
    dispatchPan: async ({ subcommand }) => {
      if (invocation === "manual") {
        return {
          ok: false,
          executionMode: "dry-run",
          stdoutSummary: `pan ${subcommand.trim()}`,
          stderrSummary: SCHEDULER_DRY_RUN_MESSAGE,
        };
      }
      const args = ["-w", "exec", "pan", ...subcommand.trim().split(/\s+/u)];
      const result = spawnSync("pnpm", args, {
        cwd: harnessRoot,
        encoding: "utf8",
        shell: false,
        env: process.env,
      });
      return {
        ok: result.status === 0,
        executionMode: "live",
        stdoutSummary: result.stdout?.trim() ?? "",
        stderrSummary: result.stderr?.trim() ?? "",
      };
    },
  };
}

export { loadRepoEnv, readCursorInvocationMode };
