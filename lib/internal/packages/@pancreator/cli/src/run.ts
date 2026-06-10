import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { asTaskId, resolveProjectPath } from "@pancreator/core";
import { Command } from "commander";
import { FileInbox } from "@pancreator/inbox";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@pancreator/intervention";
import {
  advanceFeatureDelivery,
  appendFeatureDeliveryInterventionRunLog,
  closeFeatureDeliveryArtifacts,
  readFeatureDeliveryStatusWithInterventions,
  refreshFeatureDeliveryPrompt,
  repairFeatureDeliveryState,
  resolveFeatureDeliveryNext,
  runPanCheck,
  validateArtifactsForTask,
  type PanCheckResult,
} from "./feature-delivery-run.js";
import { scaffoldContextReview } from "./context-review.js";
import { closeOutOfBandWorkspace } from "./close-out-of-band.js";
import { prepareSandbox } from "./sandbox-prepare.js";
import { reopenFeatureDelivery } from "./reopen-feature-delivery.js";
import {
  formatCountdownIdLine,
  parseInboxEntryPath,
  parseRunDirParts,
} from "./timestamp-decode.js";
import { createInterventionCheckpointPort } from "./intervention-checkpoint.js";
import { runCursorSync } from "./cursor-sync.js";
import { runCreatePancreator, runPanInit } from "./pan-init.js";

import { quoteJsonString, stringifyCliJson } from "./canonical-json-io.js";
import { runFeatureDeliveryBatch } from "./feature-delivery-batch.js";
import {
  resolveFeatureDeliveryCheckoutRoot,
  runIsolatedFeatureDelivery,
} from "./feature-delivery-worktree.js";
import {
  createFeatureDeliveryBatchProgressReporter,
  createFeatureDeliverySdkProgressReporter,
} from "./feature-delivery-sdk-progress.js";
import {
  rewriteActiveMemoryFile,
  PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
} from "./active-memory-refresh.js";
import { runTokenEconomySampleAudit } from "./commands/token-economy-sample-audit.js";
import { abortSchedulerRunByTaskId } from "@pancreator/scheduler";
import { runSchedulerTick } from "./scheduler-tick.js";
import {
  buildBuildPlanIntakeMarkdown,
  buildDefaultIntakeMarkdown,
  createIntakeDirective,
  readOptionalTextFile,
  assertIntakeSlug,
} from "./intake-scaffold.js";

export { PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE };
export { makeUtcDayBucket } from "./intake-scaffold.js";

/** Stable exit code for deferred stub verbs (`pan init`, MCP deferrals surfaced through the CLI shim, etc.). */
export const PAN_DEFERRED_EXIT_CODE = 125;

/** Fallback when a deferred verb lacks a dedicated intake — mirror `deferredToolTrackingIntake` in `@pancreator/mcp-server/lib/pan-execute.ts`. */
const BATCH_DEFERRAL_TRACKING_INTAKE =
  "lib/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
/** `pan init` / MCP `pan.init` deferral tracker — mirror `deferredToolTrackingIntake` in `@pancreator/mcp-server/lib/pan-execute.ts`. */
const PAN_INIT_DEFERRAL_TRACKING_INTAKE =
  "lib/inbox/in/172981_05-25-26/64500_0605_pan-init-and-create-pancreator-install-paths.md";

function interventionManager(repoRoot: string): InterventionManager {
  return new InterventionManager(
    new FsInterventionStore(repoRoot),
    undefined,
    createInterventionCheckpointPort(repoRoot),
  );
}

function defaultDeferredTrackingIntake(cliVerb: string): string {
  if (cliVerb === "pan init") {
    return PAN_INIT_DEFERRAL_TRACKING_INTAKE;
  }
  return BATCH_DEFERRAL_TRACKING_INTAKE;
}

export interface CliRunOptions {
  repoRoot?: string;
  writeOut?: (chunk: string) => void;
  writeErr?: (chunk: string) => void;
  /** Test hook for deterministic timestamped work paths. */
  clock?: () => Date;
  /** Injectable Cursor SDK transport for feature-delivery runner tests. */
  testHooks?: import("./feature-delivery-runner.js").FeatureDeliveryTestHooks;
  /** Injectable batch orchestration hooks for batch run tests. */
  batchTestHooks?: import("./feature-delivery-batch.js").BatchRunTestHooks;
  /** Default output format when a command omits `--format`. */
  format?: OutputFormat;
}

type OutputFormat = "json" | "text";

function resolveOutputFormat(commandFormat: string | undefined, defaultFormat?: OutputFormat): OutputFormat {
  const raw = commandFormat ?? defaultFormat ?? "json";
  return raw === "text" ? "text" : "json";
}

async function featureDeliveryCheckoutRoot(mainRepoRoot: string, taskId: string): Promise<string> {
  return await resolveFeatureDeliveryCheckoutRoot(mainRepoRoot, taskId);
}

function featureDeliverySdkProgress(options: CliRunOptions | undefined) {
  return createFeatureDeliverySdkProgressReporter({
    writeErr: options?.writeErr ?? ((chunk: string) => process.stderr.write(chunk)),
  });
}

function emit(
  writeOut: (chunk: string) => void,
  repoRoot: string,
  payload: object,
): void {
  writeOut(stringifyCliJson(repoRoot, payload));
}

function emitPayload(
  writeOut: (chunk: string) => void,
  repoRoot: string,
  payload: object,
  format: OutputFormat,
): void {
  if (format === "text") {
    writeOut(`${formatPanText(payload, repoRoot)}\n`);
    return;
  }
  emit(writeOut, repoRoot, payload);
}

export function formatPanText(payload: object, repoRoot: string = process.cwd()): string {
  const record = payload as Record<string, unknown>;
  const command = record.command;
  if (command === "inbox") {
    const entries = (record.entries as string[] | undefined) ?? [];
    return entries
      .map((entry) => {
        const parsed = parseInboxEntryPath(entry);
        if (parsed === null) {
          return entry;
        }
        return formatCountdownIdLine(parsed.dayBucket, parsed.taskId);
      })
      .join("\n");
  }
  if (command === "next") {
    const taskId = String(record.taskId ?? "");
    const runDir = String(record.runDir ?? "");
    const parsed = parseRunDirParts(runDir);
    const idLine =
      parsed !== null ? formatCountdownIdLine(parsed.dayBucket, taskId) : taskId;
    const lines = [
      `task: ${idLine}`,
      `stage: ${String(record.currentStage ?? "")}`,
      `status: ${String(record.pipelineStatus ?? "")}`,
      `next: ${String(record.nextHumanAction ?? "")}`,
    ];
    if (record.event !== null && record.event !== undefined) {
      lines.push(`event: ${String(record.event)}`);
    }
    if (record.artifact !== null && record.artifact !== undefined) {
      lines.push(`artifact: ${String(record.artifact)}`);
    }
    if (record.nextCommand !== null && record.nextCommand !== undefined) {
      lines.push(`nextCommand: ${String(record.nextCommand)}`);
    }
    if (record.reason !== undefined) {
      lines.push(`reason: ${String(record.reason)}`);
    }
    return lines.join("\n");
  }
  if (command === "status") {
    const taskId = String(record.taskId ?? "");
    const runDir = String(record.runDir ?? record.stateFile ?? "");
    const runDirRel = runDir.includes("/") ? runDir.replace(/\/state\.json$/u, "") : "";
    const parsed = parseRunDirParts(runDirRel.length > 0 ? runDirRel : runDir);
    const idLine =
      parsed !== null ? formatCountdownIdLine(parsed.dayBucket, taskId) : taskId;
    const lines = [
      `task: ${idLine}`,
      `stage: ${String(record.currentStage ?? "")}`,
      `pipeline: ${String(record.pipelineStatus ?? "")}`,
      `next: ${String(record.nextHumanAction ?? "")}`,
    ];
    if (record.nextCommand !== null && record.nextCommand !== undefined) {
      lines.push(`nextCommand: ${String(record.nextCommand)}`);
    }
    return lines.join("\n");
  }
  if (command === "run" || command === "advance" || record.command === "feature new") {
    const taskId = String(record.taskId ?? "");
    const runDir = String(record.runDir ?? record.stateFile ?? "");
    const runDirRel = runDir.includes("/") ? runDir.replace(/\/state\.json$/u, "") : "";
    const parsed = parseRunDirParts(runDirRel);
    const idLine =
      parsed !== null ? formatCountdownIdLine(parsed.dayBucket, taskId) : taskId;
    const lines = [
      `task: ${idLine}`,
      `stage: ${String(record.currentStage ?? "")}`,
      `next: ${String(record.nextHumanAction ?? "")}`,
    ];
    if (record.nextCommand !== null && record.nextCommand !== undefined) {
      lines.push(`nextCommand: ${String(record.nextCommand)}`);
    }
    if (record.warningCount !== undefined && Number(record.warningCount) > 0) {
      lines.push(`contentWarnings: ${String(record.warningCount)}`);
    }
    return lines.join("\n");
  }
  if (command === "check") {
    const checkResult = payload as PanCheckResult;
    const lines = [
      `check: ${checkResult.status} (pass=${checkResult.passCount} fail=${checkResult.failCount} skip=${checkResult.skipCount})`,
    ];
    for (const check of checkResult.checks) {
      const remediation =
        check.status === "fail" && check.remediation !== undefined ? ` — ${check.remediation}` : "";
      lines.push(`${check.status.toUpperCase()} ${check.id}: ${check.label}${remediation}`);
    }
    return lines.join("\n");
  }
  if (command === "artifacts validate") {
    const lines = [
      `status: ${String(record.status ?? "ok")}`,
      `warnings: ${String(record.warningCount ?? 0)}`,
      ...((record.warnings as Array<{ path: string; message: string }> | undefined) ?? []).map(
        (w) => `- ${w.path}: ${w.message}`,
      ),
      ...((record.missing as string[] | undefined) ?? []).map((m) => `missing: ${m}`),
    ];
    return lines.join("\n");
  }
  return stringifyCliJson(repoRoot, payload);
}

interface DeferredVerbConfig {
  readonly verb: string;
  readonly milestone: "M1" | "M2" | "M3";
  readonly manual_workaround: string;
}

function emitDeferredEnvelope(
  writeOut: (chunk: string) => void,
  repoRoot: string,
  cfg: DeferredVerbConfig,
  trackingOverride?: string,
): void {
  emit(writeOut, repoRoot, {
    status: "deferred",
    verb: cfg.verb,
    milestone: cfg.milestone,
    tracking_intake:
      trackingOverride !== undefined ? trackingOverride : defaultDeferredTrackingIntake(cfg.verb),
    manual_workaround: cfg.manual_workaround,
  });
}

interface ExitState {
  code: number;
}

function deferredVerbAction(
  repoRoot: string,
  writeOut: (chunk: string) => void,
  exit: ExitState,
  cfg: DeferredVerbConfig,
  trackingOverride?: string,
): () => Promise<void> {
  return async () => {
    emitDeferredEnvelope(writeOut, repoRoot, cfg, trackingOverride);
    exit.code = PAN_DEFERRED_EXIT_CODE;
  };
}

/**
 * Parses CLI arguments and runs the matching handler. The argv parameter MUST omit
 * the `node` binary and the script path (for example `["pause", "task-1"]`).
 */
export async function parseAndRun(
  argv: string[],
  options?: CliRunOptions,
): Promise<number> {
  const repoRoot = options?.repoRoot ?? process.cwd();
  const writeOut = options?.writeOut ?? ((c: string) => process.stdout.write(c));
  const writeErr = options?.writeErr ?? ((c: string) => process.stderr.write(c));

  const exit: ExitState = { code: 0 };

  const program = new Command();
  program.name("pan");
  program.description("Pancreator workspace CLI (bootstrap Phase 4).");
  program.configureOutput({
    writeOut: (s: string) => writeOut(s),
    writeErr: (s: string) => writeErr(s),
  });
  program.exitOverride((err: unknown) => {
    throw err;
  });

  program
    .command("cursor-sync")
    .description("Emit .cursor/agents projections from lib/personas under project_root")
    .option("--dry-run", "Print JSON envelope without writing files", false)
    .argument("[harnessRoot]", "Harness root directory (defaults to cwd)")
    .action(async (harnessRootArg: string | undefined, cmdOpts: { dryRun?: boolean }) => {
      const harnessRoot = harnessRootArg !== undefined ? path.resolve(harnessRootArg) : repoRoot;
      const dryRun = Boolean(cmdOpts.dryRun);
      try {
        emit(writeOut, repoRoot, runCursorSync(harnessRoot, { dryRun }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeErr(`${message}\n`);
        exit.code = 1;
      }
    });

  program
    .command("init")
    .description("Initialize a Pancreator workspace in the current repository (dry-run by default)")
    .option("--dry-run", "Print planned scaffold writes without applying", true)
    .option("--apply", "Write scaffold files")
    .option("--force", "Overwrite conflicting files when applying")
    .action(async (cmdOpts: { dryRun?: boolean; apply?: boolean; force?: boolean }) => {
      const dryRun = cmdOpts.apply ? false : Boolean(cmdOpts.dryRun ?? true);
      try {
        const initResult = await runPanInit({
          repoRoot,
          dryRun,
          apply: Boolean(cmdOpts.apply),
          force: Boolean(cmdOpts.force),
          clock: options?.clock,
        });
        emit(writeOut, repoRoot, initResult);
        if (initResult.status === "partial") {
          exit.code = 1;
        }
      } catch (e) {
        const err = e as Error & { exitCode?: number };
        writeErr(`${err.message}\n`);
        exit.code = err.exitCode ?? 1;
      }
    });

  program
    .command("create-pancreator")
    .description("Scaffold a new greenfield Pancreator workspace directory")
    .argument("<name>", "Project directory name to create")
    .option("--parent <dir>", "Parent directory", ".")
    .action(async (name: string, cmdOpts: { parent?: string }) => {
      const parent = path.resolve(repoRoot, cmdOpts.parent ?? ".");
      emit(
        writeOut,
        repoRoot,
        await runCreatePancreator({
          targetDir: parent,
          projectName: name,
          clock: options?.clock,
        }),
      );
    });

  const batch = program.command("batch").description("Batch feature-delivery orchestration");

  batch
    .command("run")
    .description("Run multiple feature-delivery sub-runs on isolated worktree branches")
    .argument("<inboxEntries...>", "Inbox entries relative to lib/inbox/in/")
    .option("--parallel <n>", "Maximum concurrent sub-runs (default 1)", "1")
    .option("--base <ref>", "Base ref for run branches and merge branch")
    .option("--merge-branch <name>", "Integration branch name for successful run merges")
    .option("--dry-run", "Print planned branches and inbox order without git mutations", false)
    .option("--format <format>", "Output format: json (default) or text")
    .action(
      async (
        inboxEntries: string[],
        opts: {
          parallel?: string;
          base?: string;
          mergeBranch?: string;
          dryRun?: boolean;
          format?: string;
        },
      ) => {
        const format = resolveOutputFormat(opts.format, options?.format);
        const parallel = Number.parseInt(opts.parallel ?? "1", 10);
        if (!Number.isFinite(parallel) || parallel < 1) {
          throw new Error("--parallel must be a positive integer.");
        }
        const writeErr = options?.writeErr ?? ((chunk: string) => process.stderr.write(chunk));
        const result = await runFeatureDeliveryBatch({
          repoRoot,
          args: {
            inboxEntries,
            parallel,
            baseRef: opts.base,
            mergeBranch: opts.mergeBranch,
            dryRun: Boolean(opts.dryRun),
          },
          clock: options?.clock,
          testHooks: options?.batchTestHooks,
          progress: createFeatureDeliveryBatchProgressReporter({ writeErr }),
          writeOut,
          writeErr,
        });
        if (format === "text") {
          writeOut(
            `${[
              `batch: ${result.batchId}`,
              `status: ${result.status}`,
              `ledger: ${result.ledgerPath}`,
              `merge: ${result.mergeStatus}`,
              `success: ${result.successCount}`,
              `failed: ${result.failureCount}`,
            ].join("\n")}\n`,
          );
        }
        exit.code = result.exitCode;
      },
    );

  program
    .command("run")
    .description("Run a pipeline by name (`feature-delivery` only is executable today) [deferred: M2]")
    .argument("<pipeline>", "Pipeline id")
    .argument("[inboxEntry]", "<day-bucket>/<file>.md relative to lib/inbox/in/ (not the lib/inbox/in/ prefix)")
    .option("--feature <featureId>", "Feature id override")
    .option("--task <taskId>", "Task id override matching <seconds-to-midnight>_<HHMM>_<slug>")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (pipeline: string, inboxEntry: string | undefined, opts: { feature?: string; task?: string; format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      if (pipeline !== "feature-delivery") {
        emitDeferredEnvelope(writeOut, repoRoot, {
          verb: "pan run",
          milestone: "M2",
          manual_workaround:
            "Bootstrap Phase 4 exposes only `pan feature new`/`pan run feature-delivery <inbox-entry>` orchestration until additional pipelines compile end-to-end per .docs/PRD.md.",
        });
        exit.code = PAN_DEFERRED_EXIT_CODE;
        return;
      }
      if (inboxEntry === undefined) {
        throw new Error("feature-delivery requires an inbox entry under lib/inbox/in/.");
      }
      emitPayload(
        writeOut,
        repoRoot,
        await runIsolatedFeatureDelivery(
          {
            repoRoot,
            inboxEntry,
            featureId: opts.feature,
            taskId: opts.task,
            clock: options?.clock,
            testHooks: options?.testHooks,
            progress: featureDeliverySdkProgress(options),
          },
          "run",
        ),
        format,
      );
    });

  program
    .command("inbox")
    .description("List pending human directives under lib/inbox/in/")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (opts: { format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      const inbox = new FileInbox(repoRoot);
      const entries = await inbox.listIn();
      emitPayload(writeOut, repoRoot, { command: "inbox", status: "ok", entries }, format);
    });

  const feature = program
    .command("feature")
    .description("Manage feature-delivery artifacts");

  feature
    .command("new")
    .description("Start a feature-delivery run from an inbox directive")
    .argument("<inboxEntry>", "<day-bucket>/<file>.md relative to lib/inbox/in/ (not the lib/inbox/in/ prefix)")
    .option("--feature <featureId>", "Feature id override")
    .option("--task <taskId>", "Task id override matching <seconds-to-midnight>_<HHMM>_<slug>")
    .action(async (inboxEntry: string, opts: { feature?: string; task?: string }) => {
      emit(
        writeOut,
        repoRoot,
        await runIsolatedFeatureDelivery(
          {
            repoRoot,
            inboxEntry,
            featureId: opts.feature,
            taskId: opts.task,
            clock: options?.clock,
            testHooks: options?.testHooks,
            progress: featureDeliverySdkProgress(options),
          },
          "feature new",
        ),
      );
    });

  const contextReview = program
    .command("context-review")
    .description("Out-of-band context review scaffolding (no feature-delivery task id required)");

  const collectRepeatableOption = (value: string, previous: string[] = []): string[] =>
    previous.concat([value]);

  contextReview
    .command("scaffold")
    .description("Write context-review-prompt.md under .pan/sandboxes/ for operator delegation to context-reviewer")
    .option(
      "--workspace <path>",
      "Repo-relative workspace under .pan/sandboxes/ (default: .pan/sandboxes/context-review)",
    )
    .option("--run-dir <path>", "Optional .pan/work/<day>/<slug> to pull artifact and touch-set paths from")
    .option("--scope-path <path>", "Repeatable explicit diff scope path", collectRepeatableOption, [])
    .option(
      "--context-path <path>",
      "Repeatable operator context doc to read (plan, spec, ADR, etc.)",
      collectRepeatableOption,
      [],
    )
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (opts: { workspace?: string; runDir?: string; scopePath?: string[]; contextPath?: string[]; format?: string }) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      emitPayload(
        writeOut,
        repoRoot,
        await scaffoldContextReview({
          repoRoot,
          workspace: opts.workspace,
          runDir: opts.runDir,
          scopePaths: opts.scopePath,
          contextPaths: opts.contextPath,
        }),
        format,
      );
    });

  program
    .command("status")
    .description("Show pipeline and workspace status [deferred: M2 when task id omitted]")
    .argument("[taskId]", "Task id under .pan/work/")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (taskId: string | undefined, opts: { format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      if (taskId === undefined) {
        emitDeferredEnvelope(writeOut, repoRoot, {
          verb: "pan status",
          milestone: "M2",
          manual_workaround:
            "Pass a Phase-4 feature-delivery task id to read `state.json`; aggregate workspace dashboards remain deferred.",
        });
        exit.code = PAN_DEFERRED_EXIT_CODE;
        return;
      }
      const mgr = interventionManager(repoRoot);
      emitPayload(
        writeOut,
        repoRoot,
        await readFeatureDeliveryStatusWithInterventions(
          await featureDeliveryCheckoutRoot(repoRoot, taskId),
          taskId,
          (id) => mgr.loadActiveState(id),
        ),
        format,
      );
    });

  program
    .command("next")
    .description("Resolve the next feature-delivery advance command without mutating state")
    .argument("<taskId>", "Task id under .pan/work/")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (taskId: string, opts: { format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      emitPayload(
        writeOut,
        repoRoot,
        await resolveFeatureDeliveryNext(await featureDeliveryCheckoutRoot(repoRoot, taskId), taskId),
        format,
      );
    });

  program
    .command("advance")
    .description("Advance a feature-delivery task by one validated stage transition")
    .argument("<taskId>", "Task id under .pan/work/")
    .requiredOption("--artifact <path>", "Repo-relative artifact proving the current stage completed")
    .option("--event <event>", "Transition event override, for example must_fix during review")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (taskId: string, opts: { artifact: string; event?: string; format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      const result = await advanceFeatureDelivery({
        repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
        taskId,
        artifact: opts.artifact,
        event: opts.event,
        clock: options?.clock,
        testHooks: options?.testHooks,
        progress: featureDeliverySdkProgress(options),
      });
      emitPayload(writeOut, repoRoot, result, format);
    });

  const artifacts = program.command("artifacts").description("Feature-delivery artifact tools");

  artifacts
    .command("validate")
    .description("Read-only warn-first content validation for a stage")
    .argument("<taskId>", "Task id under .pan/work/")
    .requiredOption("--stage <stage>", "Pipeline stage id")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (taskId: string, opts: { stage: string; format?: string }, _cmd) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      const result = await validateArtifactsForTask({
        repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
        taskId,
        stage: opts.stage,
      });
      emitPayload(writeOut, repoRoot, result, format);
      if (result.missing.length > 0 || result.warningCount > 0) {
        exit.code = 1;
      }
    });

  const emitPanCheck = async (opts: { format?: string }) => {
    const format = resolveOutputFormat(opts.format, options?.format);
    const result = await runPanCheck(repoRoot);
    emitPayload(writeOut, repoRoot, result, format);
    if (result.status === "fail") {
      exit.code = 1;
    }
  };

  program
    .command("check")
    .description(
      "Run read-only pre-close validation checks (reports pass/fail; does not modify the repository)",
    )
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (opts: { format?: string }) => {
      await emitPanCheck(opts);
    });

  program
    .command("doctor")
    .description("Deprecated alias for pan check")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (opts: { format?: string }) => {
      const writeErr = options?.writeErr ?? ((chunk: string) => process.stderr.write(chunk));
      writeErr(
        "pan doctor is deprecated; use `pnpm -w exec pan check` (read-only validation, no auto-fix).\n",
      );
      await emitPanCheck(opts);
    });

  program
    .command("repair-state")
    .description("Explicitly repair a feature-delivery ledger after out-of-band manual .pan/work")
    .argument("<taskId>", "Task id under .pan/work/")
    .requiredOption("--stage <stage>", "Stage the ledger should reflect")
    .requiredOption("--artifact <path>", "Repo-relative evidence artifact justifying the repair")
    .requiredOption("--reason <text>", "Human-readable reason for the repair")
    .action(async (taskId: string, opts: { stage: string; artifact: string; reason: string }) => {
      emit(
        writeOut,
        repoRoot,
        await repairFeatureDeliveryState({
          repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
          taskId,
          stage: opts.stage,
          artifact: opts.artifact,
          reason: opts.reason,
          clock: options?.clock,
          testHooks: options?.testHooks,
          progress: featureDeliverySdkProgress(options),
        }),
      );
    });

  program
    .command("refresh-prompt")
    .description("Regenerate feature-delivery handoff.md and next-prompt.md from the current ledger state")
    .argument("<taskId>", "Task id under .pan/work/")
    .action(async (taskId: string) => {
      emit(
        writeOut,
        repoRoot,
        await refreshFeatureDeliveryPrompt({
          repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
          taskId,
        }),
      );
    });

  const sandbox = program.command("sandbox").description("Operator scratch QA workspaces under .pan/sandboxes/");

  sandbox
    .command("prepare")
    .description("Copy touch-set paths into .pan/sandboxes/<task-id>/ for isolated manual QA")
    .argument("<taskId>", "Task id under .pan/work/")
    .option("--format <format>", "Output format: json (default) or text")
    .action(async (taskId: string, opts: { format?: string }) => {
      const format = resolveOutputFormat(opts.format, options?.format);
      emitPayload(
        writeOut,
        repoRoot,
        await prepareSandbox({
          repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
          taskId,
          clock: options?.clock,
        }),
        format,
      );
    });

  program
    .command("close-artifacts")
    .description("Archive a completed feature-delivery run and its source inbox directive")
    .argument("<taskId>", "Task id under .pan/work/")
    .action(async (taskId: string) => {
      emit(
        writeOut,
        repoRoot,
        await closeFeatureDeliveryArtifacts({
          repoRoot: await featureDeliveryCheckoutRoot(repoRoot, taskId),
          taskId,
          clock: options?.clock,
        }),
      );
    });

  program
    .command("close-out-of-band")
    .description("Archive an ad-hoc work directory after operator verification is authored")
    .argument("<runDir>", "Repo-relative run directory .pan/work/<day>/<task-id>")
    .requiredOption("--feature <featureId>", "Feature id for the ad-hoc workspace")
    .requiredOption("--reason <text>", "Human-readable reason for closing the workspace")
    .option("--inbox-source <path>", "Repo-relative source inbox path under lib/inbox/in/")
    .option("--scaffold-verification", "Write operator-verification.md scaffold when missing (tests only)")
    .action(
      async (
        runDir: string,
        opts: { feature: string; reason: string; inboxSource?: string; scaffoldVerification?: boolean },
      ) => {
        emit(
          writeOut,
          repoRoot,
          await closeOutOfBandWorkspace({
            repoRoot,
            runDirRel: runDir,
            featureId: opts.feature,
            reason: opts.reason,
            inboxSourceRel: opts.inboxSource,
            scaffoldVerification: opts.scaffoldVerification === true,
            clock: options?.clock,
          }),
        );
      },
    );

  program
    .command("reopen")
    .description("Unarchive a closed task and restore it to intake or a specific pipeline stage")
    .argument("<taskId>", "Task id under .pan/archive/work/")
    .requiredOption("--reason <text>", "Human-readable reason for reopening")
    .option("--stage <stage>", "Pipeline stage to restore (default: intake)")
    .action(async (taskId: string, opts: { reason: string; stage?: string }) => {
      emit(
        writeOut,
        repoRoot,
        await reopenFeatureDelivery({
          repoRoot,
          taskId,
          stage: opts.stage,
          reason: opts.reason,
          clock: options?.clock,
          testHooks: options?.testHooks,
          progress: featureDeliverySdkProgress(options),
        }),
      );
    });

  program
    .command("approve")
    .description("Approve a gated action [deferred: M3]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "pan approve",
        milestone: "M3",
        manual_workaround:
          "Approve human gates through the supervising operator workflow until `LocalUserAuthorizer` automation lands under .docs/PRD.md §10.",
      }),
    );

  program
    .command("memory")
    .description("Inspect Memory tier indexes [deferred: M2]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "pan memory",
        milestone: "M2",
        manual_workaround:
          "Orient with `lib/memory/handbook/context-economy.md` and read explicit memory files until MemoryRouter CLI surfaces harden.",
      }),
    );

  program
    .command("contracts")
    .description("List or evaluate Spec Contracts [deferred: M2]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "pan contracts",
        milestone: "M2",
        manual_workaround:
          "Run targeted descriptors under `tests/compliance/` until the consolidated contract runner ships as a CLI verb.",
      }),
    );

  program
    .command("lint")
    .description("Run repository lint and policy gates [deferred: M1]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "pan lint",
        milestone: "M1",
        manual_workaround:
          "Use `pnpm lint` and `pnpm run check:phase0a` locally until pan wraps the bundles.",
      }),
    );

  const intakeCmd = program
    .command("intake")
    .description("Create canonical inbox directives nested under UTC day buckets in lib/inbox/in/.");

  intakeCmd
    .command("new")
    .argument("<slug>", "Semantic basename suffix (lowercase slug with hyphens)")
    .description("Emit a templated inbox directive with canonical timestamp prefixes")
    .option("--title <text>", "Directive title shown in Markdown heading and YAML frontmatter", "")
    .option("--owner <persona>", "Owner recorded in YAML frontmatter", "intake-analyst")
    .option("--feature-id <id>", "Feature id retained in YAML frontmatter")
    .option("--from-template <name>", "Use lib/memory/handbook/contract-templates/<name>.template.md as the Markdown body scaffold")
    .action(
      async (
        slugArg: string,
        cmdOpts: { title?: string; owner?: string; featureId?: string; fromTemplate?: string },
      ) => {
        assertIntakeSlug(slugArg);
        const now = options?.clock !== undefined ? options.clock() : new Date();
        const title = cmdOpts.title && cmdOpts.title.length > 0 ? cmdOpts.title : slugArg;
        const owner = cmdOpts.owner ?? "intake-analyst";
        const featureId = cmdOpts.featureId ?? slugArg;
        const createdIso = now.toISOString();
        let fileText: string;
        if (cmdOpts.fromTemplate !== undefined && cmdOpts.fromTemplate !== "") {
          const templateRel = path.posix.join(
            "lib/memory/handbook/contract-templates",
            `${cmdOpts.fromTemplate}.template.md`,
          );
          const templateAbs = resolveProjectPath(repoRoot, ...templateRel.split("/"));
          if (!existsSync(templateAbs)) {
            throw new Error(
              `Missing contract template "${cmdOpts.fromTemplate}" (expected ${templateRel}); pick a handbook template.`,
            );
          }
          const templateBody = await readFile(templateAbs, "utf8");
          fileText = [
            "---",
            `title: ${quoteJsonString(title)}`,
            `feature_id: ${quoteJsonString(featureId)}`,
            "stage: intake",
            `owner: ${quoteJsonString(owner)}`,
            "status: open",
            `created_at: ${quoteJsonString(createdIso)}`,
            "references: []",
            "---",
            "",
            templateBody.trimEnd(),
            "",
          ].join("\n");
        } else {
          fileText = buildDefaultIntakeMarkdown({ title, featureId, owner, createdIso });
        }
        const created = await createIntakeDirective({
          repoRoot,
          slug: slugArg,
          now,
          fileText,
        });
        emit(writeOut, repoRoot, { command: "intake new", status: "ok", path: created.path });
      },
    );

  intakeCmd
    .command("from-build-plan")
    .argument("<slug>", "Semantic basename suffix (lowercase slug with hyphens)")
    .description(
      "Emit an inbox directive from a Cursor Build-mode operator prompt and completed plan snapshot",
    )
    .option("--title <text>", "Directive title shown in Markdown heading and YAML frontmatter", "")
    .option("--owner <persona>", "Owner recorded in YAML frontmatter", "intake-analyst")
    .option("--feature-id <id>", "Feature id retained in YAML frontmatter")
    .option("--operator-prompt <text>", "Verbatim operator prompt from Cursor Build mode")
    .option("--prompt-file <path>", "Read operator prompt from a repo-relative or absolute file")
    .option("--plan-text <text>", "Completed plan markdown shown to the operator")
    .option("--plan-file <path>", "Read completed plan markdown from a repo-relative or absolute file")
    .action(
      async (
        slugArg: string,
        cmdOpts: {
          title?: string;
          owner?: string;
          featureId?: string;
          operatorPrompt?: string;
          promptFile?: string;
          planText?: string;
          planFile?: string;
        },
      ) => {
        assertIntakeSlug(slugArg);
        const operatorPrompt =
          cmdOpts.promptFile !== undefined && cmdOpts.promptFile.length > 0
            ? (await readOptionalTextFile(repoRoot, cmdOpts.promptFile)).trim()
            : (cmdOpts.operatorPrompt ?? "").trim();
        const planText =
          cmdOpts.planFile !== undefined && cmdOpts.planFile.length > 0
            ? (await readOptionalTextFile(repoRoot, cmdOpts.planFile)).trim()
            : (cmdOpts.planText ?? "").trim();
        if (operatorPrompt.length === 0) {
          throw new Error(
            "from-build-plan requires --operator-prompt or --prompt-file with non-empty content.",
          );
        }
        if (planText.length === 0) {
          throw new Error("from-build-plan requires --plan-text or --plan-file with non-empty content.");
        }
        const now = options?.clock !== undefined ? options.clock() : new Date();
        const title = cmdOpts.title && cmdOpts.title.length > 0 ? cmdOpts.title : slugArg;
        const owner = cmdOpts.owner ?? "intake-analyst";
        const featureId = cmdOpts.featureId ?? slugArg;
        const fileText = buildBuildPlanIntakeMarkdown({
          title,
          featureId,
          owner,
          createdIso: now.toISOString(),
          operatorPrompt,
          planText,
        });
        const created = await createIntakeDirective({
          repoRoot,
          slug: slugArg,
          now,
          fileText,
        });
        emit(writeOut, repoRoot, {
          command: "intake from-build-plan",
          status: "ok",
          path: created.path,
          slug: slugArg,
        });
      },
    );

  program
    .command("refresh-active-memory")
    .description("Rewrite shipped Feature table and operator-note refresh stamp in lib/memory/active/current.md; Active Feature is human-curated")
    .option("--dry-run", "Print the computed diff without writing current.md", false)
    .option(
      "--accept-derived",
      "Apply derived shipped-feature rows when they are the only divergence from index.json",
      false,
    )
    .action(async (cmdOpts: { dryRun?: boolean; acceptDerived?: boolean }) => {
      const dryRun = Boolean(cmdOpts.dryRun);
      const code = await rewriteActiveMemoryFile({
        repoRoot,
        dryRun,
        acceptDerived: Boolean(cmdOpts.acceptDerived),
        writeOut,
        writeErr,
        clock: options?.clock ?? (() => new Date()),
      });
      if (code === 0) {
        emit(writeOut, repoRoot, {
          command: "refresh-active-memory",
          status: "ok",
          ...(dryRun ? { dryRun: true } : { path: "lib/memory/active/current.md" }),
        });
      }
      exit.code = code;
    });

  const tokenEconomy = program
    .command("token-economy")
    .description("Token economy observability for sampled feature-delivery SDK runs");

  tokenEconomy
    .command("sample-audit")
    .description("Incrementally audit sdk-traces summaries newer than the last watermark")
    .option("--since <iso>", "Restrict scan to summaries at or after this ISO timestamp")
    .option("--sampled-only-task <taskId>", "Restrict analysis to one task work directory")
    .option("--repair", "Run bounded repair for low/medium findings; defer high-scope to inbox", false)
    .action(async (cmdOpts: { since?: string; sampledOnlyTask?: string; repair?: boolean }) => {
      const result = await runTokenEconomySampleAudit({
        repoRoot,
        since: cmdOpts.since,
        sampledOnlyTask: cmdOpts.sampledOnlyTask,
        repair: Boolean(cmdOpts.repair),
        clock: options?.clock,
      });
      emit(writeOut, repoRoot, {
        command: "token-economy sample-audit",
        status: "ok",
        report_path: result.reportPath,
        summaries_scanned: result.report.summaries_scanned,
        finding_count: result.report.findings.length,
        ...(result.report.repair ? { repair: result.report.repair } : {}),
      });
    });

  const scheduler = program.command("scheduler").description("Local automation scheduler");

  scheduler
    .command("tick")
    .description("Evaluate due automations and dispatch enabled triggers")
    .option("--id <automationId>", "Dispatch one automation immediately (manual trigger)")
    .action(async (opts: { id?: string }) => {
      const result = await runSchedulerTick({
        repoRoot,
        automationId: opts.id?.trim() || undefined,
      });
      emit(writeOut, repoRoot, {
        command: "scheduler tick",
        status: result.exitCode === 0 ? "ok" : "error",
        outcomes: result.outcomes,
      });
      exit.code = result.exitCode;
    });

  program
    .command("pause")
    .description("Append a pause intervention for a task")
    .argument("<taskId>", "Task id under .pan/work/")
    .action(async (taskId: string) => {
      const mgr = interventionManager(repoRoot);
      await mgr.pause(asTaskId(taskId));
      await appendFeatureDeliveryInterventionRunLog({
        repoRoot,
        taskId,
        command: "pause",
        clock: options?.clock,
      });
      emit(writeOut, repoRoot, { command: "pause", status: "ok", taskId });
    });

  program
    .command("resume")
    .description("Append a resume intervention for a task")
    .argument("<taskId>", "Task id under .pan/work/")
    .option(
      "--checkpoint <checkpointId>",
      "Optional checkpoint id for time-travel resume",
    )
    .action(async (taskId: string, opts: { checkpoint?: string }) => {
      const mgr = interventionManager(repoRoot);
      const cp = opts.checkpoint as CheckpointId | undefined;
      await mgr.resume(asTaskId(taskId), cp);
      await appendFeatureDeliveryInterventionRunLog({
        repoRoot,
        taskId,
        command: "resume",
        clock: options?.clock,
      });
      emit(writeOut, repoRoot, {
        command: "resume",
        status: "ok",
        taskId,
        checkpointId: opts.checkpoint ?? null,
      });
    });

  program
    .command("abort")
    .description("Append an abort intervention for a task")
    .argument("<taskId>", "Task id under .pan/work/")
    .option("--reason <text>", "Optional abort reason")
    .action(async (taskId: string, opts: { reason?: string }) => {
      const mgr = interventionManager(repoRoot);
      await mgr.abort(asTaskId(taskId), opts.reason);
      await appendFeatureDeliveryInterventionRunLog({
        repoRoot,
        taskId,
        command: "abort",
        abortReason: opts.reason,
        clock: options?.clock,
      });
      const abortedAt =
        options?.clock !== undefined ? options.clock() : new Date();
      await abortSchedulerRunByTaskId(repoRoot, taskId, abortedAt.toISOString());
      emit(writeOut, repoRoot, {
        command: "abort",
        status: "ok",
        taskId,
        reason: opts.reason ?? null,
      });
    });

  try {
    await program.parseAsync(argv, { from: "user" });
    return exit.code;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "commander.helpDisplayed"
    ) {
      return exit.code;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message === "(outputHelp)") {
      return exit.code;
    }
    if (message.length > 0 && !message.startsWith("error:")) {
      emit(writeOut, repoRoot, { command: "error", status: "error", message });
    }
    return 1;
  }
}
