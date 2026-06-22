#!/usr/bin/env node
import { readdirSync } from "node:fs";
import path from "node:path";
import { PanError } from "./lib/errors.mjs";
import {
  abortRun,
  assessStage,
  createRun,
  decideRun,
  getRunState,
  getRunStatus,
  prepareInvocation,
  resumeRun,
  submitOutput,
} from "./lib/engine.mjs";
import { isGitRepository } from "./lib/git.mjs";
import { fileExists, findProjectRoot, readJson } from "./lib/io.mjs";
import { validateRepository } from "./lib/validation.mjs";

const HELP = `Pancreator v2 prototype

Usage:
  pan init --request <repo-relative-file> [--workflow dev] [--title <title>]
  pan prepare <run-id>
  pan submit <run-id> <output-json>
  pan assess <run-id> <assessment-json>
  pan decide <run-id> <approve|reject> [--note <text>]
  pan resume <run-id> [--stage <stage-slug>]
  pan abort <run-id> [--note <text>]
  pan status <run-id> [--json]
  pan list [--json]
  pan validate [--json]
  pan doctor [--json]

The harness does not invoke models. Cursor's supervisor reads invocation cards,
delegates to named Cursor subagents, and returns their structured output to this CLI.
`;

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new PanError(`${name} requires a value.`, { code: "INVALID_ARGUMENT" });
  return value;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function print(value, asJson = false) {
  if (asJson || typeof value !== "string") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
  }
}

function listRuns(root) {
  const base = path.join(root, "runtime", "logs", "workflows");
  if (!fileExists(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fileExists(path.join(base, entry.name, "state.json")))
    .map((entry) => readJson(path.join(base, entry.name, "state.json")))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((state) => ({
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action?.type,
      updated_at: state.updated_at,
    }));
}

async function main() {
  const root = findProjectRoot();
  const [command = "help", ...args] = process.argv.slice(2);
  const json = hasFlag(args, "--json");

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      print(HELP);
      return;
    case "init": {
      const state = createRun(root, {
        workflowSlug: option(args, "--workflow", "dev"),
        requestPath: option(args, "--request"),
        title: option(args, "--title"),
      });
      print({
        status: "created",
        run_id: state.run_id,
        next_command: `./bin/pan prepare ${state.run_id}`,
        state_path: `runtime/logs/workflows/${state.run_id}/state.json`,
      });
      return;
    }
    case "prepare": {
      const runId = args[0];
      const result = prepareInvocation(root, runId);
      if (!result.invocation) {
        print({ status: result.state.status, reason: result.state.pause_reason, decision_path: result.state.last_decision_path });
      } else {
        print({
          status: "ready",
          run_id: runId,
          stage: result.invocation.stage.slug,
          persona: result.invocation.stage.persona,
          invocation_json: result.state.current_invocation.json_path,
          invocation_markdown: result.state.current_invocation.markdown_path,
          expected_output: result.state.current_invocation.output_path,
        });
      }
      return;
    }
    case "submit": {
      const [runId, outputPath] = args;
      const result = submitOutput(root, runId, outputPath);
      print({
        status: result.state.status,
        outcome: result.record.outcome,
        stage: result.record.stage.slug,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
      });
      return;
    }
    case "assess": {
      const [runId, assessmentPath] = args;
      const result = assessStage(root, runId, assessmentPath);
      print({ status: result.state.status, verdict: result.assessment.verdict, next_stage: result.state.current_stage, pending_action: result.state.pending_action });
      return;
    }
    case "decide": {
      const [runId, decision] = args;
      const state = decideRun(root, runId, decision, option(args, "--note", ""));
      print({ status: state.status, next_stage: state.current_stage, pending_action: state.pending_action });
      return;
    }
    case "resume": {
      const runId = args[0];
      const state = resumeRun(root, runId, option(args, "--stage"));
      print({ status: state.status, current_stage: state.current_stage, next_command: `./bin/pan prepare ${runId}` });
      return;
    }
    case "abort": {
      const runId = args[0];
      const state = abortRun(root, runId, option(args, "--note", ""));
      print({ status: state.status, run_id: runId });
      return;
    }
    case "status": {
      const runId = args[0];
      print(getRunStatus(root, runId, { json }), json);
      return;
    }
    case "list":
      print(listRuns(root), true);
      return;
    case "validate": {
      const result = validateRepository(root);
      print(result, true);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    case "doctor": {
      const validation = validateRepository(root);
      const nodeMajor = Number(process.versions.node.split(".")[0]);
      const result = {
        ok: validation.ok && nodeMajor >= 22,
        node: { version: process.versions.node, supported: nodeMajor >= 22 },
        git: { available_repository: isGitRepository(root) },
        validation,
        constraints: {
          external_runtime_dependencies: 0,
          orchestration_runtime: "Cursor supervisor + repository state machine",
          supported_integrations: ["Cursor subagents", "Cursor commands", "Cursor rules", "MCP tools available to Cursor"],
        },
      };
      print(result, true);
      if (!result.ok) process.exitCode = 1;
      return;
    }
    default:
      throw new PanError(`Unknown command: ${command}\n\n${HELP}`, { code: "UNKNOWN_COMMAND" });
  }
}

main().catch((error) => {
  const known = error instanceof PanError;
  const payload = {
    error: known ? error.code : "UNEXPECTED_ERROR",
    message: error.message,
    ...(known && error.details ? { details: error.details } : {}),
  };
  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exitCode = known ? error.exitCode : 1;
});
