import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  startFeatureDelivery,
} from "./feature-delivery-run.js";
import { createInterventionCheckpointPort } from "./intervention-checkpoint.js";
import { runCreatePancreator, runPanInit } from "./pan-init.js";

import { stringifyCliJson } from "./canonical-json-io.js";
import {
  rewriteActiveMemoryFile,
  PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
} from "./active-memory-refresh.js";

export { PAN_ACTIVE_MEMORY_CONFLICT_EXIT_CODE };

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

const FDS_UTC_MS = Date.UTC(2500, 0, 1, 0, 0, 0, 0);

export interface CliRunOptions {
  repoRoot?: string;
  writeOut?: (chunk: string) => void;
  writeErr?: (chunk: string) => void;
  /** Test hook for deterministic timestamped work paths. */
  clock?: () => Date;
  /** Injectable Cursor SDK transport for feature-delivery runner tests. */
  testHooks?: import("./feature-delivery-runner.js").FeatureDeliveryTestHooks;
}

function emit(
  writeOut: (chunk: string) => void,
  repoRoot: string,
  payload: object,
): void {
  writeOut(stringifyCliJson(repoRoot, payload));
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

function makeUtcDayBucket(now: Date): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0, 0);
  const daysToFds = Math.floor((FDS_UTC_MS - dayStart) / 86400000);
  const mm = String(m + 1).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  const yy = String(y % 100).padStart(2, "0");
  return `${daysToFds}_${mm}-${dd}-${yy}`;
}

/** Seconds remaining until the next UTC midnight; matches task-id SID semantics. */
function secondsToMidnightUtc(now: Date): number {
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  const nextDayStart = dayStart + 86400000;
  return Math.max(0, Math.floor((nextDayStart - now.getTime()) / 1000));
}

function utcHhmm(now: Date): string {
  return `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;
}

function buildDefaultIntakeMarkdown(opts: {
  readonly title: string;
  readonly featureId: string;
  readonly owner: string;
  readonly createdIso: string;
}): string {
  const fm = [
    "---",
    `title: ${JSON.stringify(opts.title)}`,
    `feature_id: ${JSON.stringify(opts.featureId)}`,
    "stage: intake",
    `owner: ${JSON.stringify(opts.owner)}`,
    "status: open",
    `created_at: ${JSON.stringify(opts.createdIso)}`,
    "references: []",
    "---",
    "",
    `# ${opts.title}`,
    "",
    "## Problem",
    "",
    "## Goal",
    "",
    "## Required outcomes",
    "",
    "## Acceptance criteria",
    "",
    "## Out of scope",
    "",
  ].join("\n");
  return fm;
}

function isArchivedDayBucketCollision(repoRoot: string, dayBucket: string): boolean {
  const active = resolveProjectPath(repoRoot, "lib", "inbox", "in", dayBucket);
  const archived = resolveProjectPath(repoRoot, "archive", "inbox", "in", dayBucket);
  return existsSync(active) && existsSync(archived);
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

  program
    .command("run")
    .description("Run a pipeline by name (`feature-delivery` only is executable today) [deferred: M2]")
    .argument("<pipeline>", "Pipeline id")
    .argument("[inboxEntry]", "<day-bucket>/<file>.md relative to lib/inbox/in/ (not the lib/inbox/in/ prefix)")
    .option("--feature <featureId>", "Feature id override")
    .option("--task <taskId>", "Task id override matching <seconds-to-midnight>_<HHMM>_<slug>")
    .action(async (pipeline: string, inboxEntry: string | undefined, opts: { feature?: string; task?: string }) => {
      if (pipeline !== "feature-delivery") {
        emitDeferredEnvelope(writeOut, repoRoot, {
          verb: "pan run",
          milestone: "M2",
          manual_workaround:
            "Bootstrap Phase 4 exposes only `pan feature new`/`pan run feature-delivery <inbox-entry>` orchestration until additional pipelines compile end-to-end per docs/PRD.md.",
        });
        exit.code = PAN_DEFERRED_EXIT_CODE;
        return;
      }
      if (inboxEntry === undefined) {
        throw new Error("feature-delivery requires an inbox entry under lib/inbox/in/.");
      }
      emit(
        writeOut,
        repoRoot,
        await startFeatureDelivery(
          {
            repoRoot,
            inboxEntry,
            featureId: opts.feature,
            taskId: opts.task,
            clock: options?.clock,
            testHooks: options?.testHooks,
          },
          "run",
        ),
      );
    });

  program
    .command("inbox")
    .description("List pending human directives under lib/inbox/in/")
    .action(async () => {
      const inbox = new FileInbox(repoRoot);
      const entries = await inbox.listIn();
      emit(writeOut, repoRoot, { command: "inbox", status: "ok", entries });
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
        await startFeatureDelivery(
          {
            repoRoot,
            inboxEntry,
            featureId: opts.feature,
            taskId: opts.task,
            clock: options?.clock,
            testHooks: options?.testHooks,
          },
          "feature new",
        ),
      );
    });

  program
    .command("status")
    .description("Show pipeline and workspace status [deferred: M2 when task id omitted]")
    .argument("[taskId]", "Task id under work/")
    .action(async (taskId: string | undefined) => {
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
      emit(
        writeOut,
        repoRoot,
        await readFeatureDeliveryStatusWithInterventions(repoRoot, taskId, (id) =>
          mgr.loadActiveState(id),
        ),
      );
    });


  program
    .command("advance")
    .description("Advance a feature-delivery task by one validated stage transition")
    .argument("<taskId>", "Task id under work/")
    .requiredOption("--artifact <path>", "Repo-relative artifact proving the current stage completed")
    .option("--event <event>", "Transition event override, for example must_fix during review")
    .action(async (taskId: string, opts: { artifact: string; event?: string }) => {
      emit(
        writeOut,
        repoRoot,
        await advanceFeatureDelivery({
          repoRoot,
          taskId,
          artifact: opts.artifact,
          event: opts.event,
          clock: options?.clock,
          testHooks: options?.testHooks,
        }),
      );
    });

  program
    .command("repair-state")
    .description("Explicitly repair a feature-delivery ledger after out-of-band manual work")
    .argument("<taskId>", "Task id under work/")
    .requiredOption("--stage <stage>", "Stage the ledger should reflect")
    .requiredOption("--artifact <path>", "Repo-relative evidence artifact justifying the repair")
    .requiredOption("--reason <text>", "Human-readable reason for the repair")
    .action(async (taskId: string, opts: { stage: string; artifact: string; reason: string }) => {
      emit(
        writeOut,
        repoRoot,
        await repairFeatureDeliveryState({
          repoRoot,
          taskId,
          stage: opts.stage,
          artifact: opts.artifact,
          reason: opts.reason,
          clock: options?.clock,
        }),
      );
    });

  program
    .command("refresh-prompt")
    .description("Regenerate feature-delivery handoff.md and next-prompt.md from the current ledger state")
    .argument("<taskId>", "Task id under work/")
    .action(async (taskId: string) => {
      emit(
        writeOut,
        repoRoot,
        await refreshFeatureDeliveryPrompt({
          repoRoot,
          taskId,
        }),
      );
    });

  program
    .command("close-artifacts")
    .description("Archive a completed feature-delivery run and its source inbox directive")
    .argument("<taskId>", "Task id under work/")
    .action(async (taskId: string) => {
      emit(
        writeOut,
        repoRoot,
        await closeFeatureDeliveryArtifacts({
          repoRoot,
          taskId,
          clock: options?.clock,
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
          "Approve human gates through the supervising operator workflow until `LocalUserAuthorizer` automation lands under docs/PRD.md §10.",
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
          "Use `pnpm lint`, `pnpm run check:phase0a`, and `bash -n .cursor/hooks/enforce-policy-compliance.sh` locally until pan wraps the bundles.",
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
        const slugOk = /^[a-z0-9][a-z0-9_-]*$/u.test(slugArg);
        if (!slugOk) {
          throw new Error("slug MUST use lowercase letters, digits, underscores, or hyphens starting with alphanumerics.");
        }
        if (!existsSync(path.join(repoRoot, "pancreator.yaml"))) {
          throw new Error("Missing pancreator.yaml at repository root; run from an initialized Pancreator workspace.");
        }
        const now = options?.clock !== undefined ? options.clock() : new Date();
        const dayBucket = makeUtcDayBucket(now);
        if (isArchivedDayBucketCollision(repoRoot, dayBucket)) {
          throw new Error(
            `Refusing to write into archived day-bucket ${dayBucket} because both lib/inbox/in and archive/inbox/in contain that directory.`,
          );
        }
        const sid = secondsToMidnightUtc(now);
        const hhmm = utcHhmm(now);
        const targetRel = path.posix.join("lib/inbox/in", dayBucket, `${sid}_${hhmm}_${slugArg}.md`);
        const targetAbs = path.join(repoRoot, targetRel);
        if (existsSync(targetAbs)) {
          throw new Error(`Refusing to overwrite existing inbox directive at ${targetRel}.`);
        }
        const title = cmdOpts.title && cmdOpts.title.length > 0 ? cmdOpts.title : slugArg;
        const owner = cmdOpts.owner ?? "intake-analyst";
        const featureId = cmdOpts.featureId ?? slugArg;
        const createdIso = now.toISOString();
        await mkdir(path.dirname(targetAbs), { recursive: true });
        let fileText: string;
        if (cmdOpts.fromTemplate !== undefined && cmdOpts.fromTemplate !== "") {
          const templateRel = path.posix.join(
            "lib/memory/handbook/contract-templates",
            `${cmdOpts.fromTemplate}.template.md`,
          );
          const templateAbs = path.join(repoRoot, ...templateRel.split("/"));
          if (!existsSync(templateAbs)) {
            throw new Error(
              `Missing contract template "${cmdOpts.fromTemplate}" (expected ${templateRel}); pick a handbook template.`,
            );
          }
          const templateBody = await readFile(templateAbs, "utf8");
          fileText = [
            "---",
            `title: ${JSON.stringify(title)}`,
            `feature_id: ${JSON.stringify(featureId)}`,
            "stage: intake",
            `owner: ${JSON.stringify(owner)}`,
            "status: open",
            `created_at: ${JSON.stringify(createdIso)}`,
            "references: []",
            "---",
            "",
            templateBody.trimEnd(),
            "",
          ].join("\n");
        } else {
          fileText = buildDefaultIntakeMarkdown({ title, featureId, owner, createdIso });
        }
        await writeFile(targetAbs, `${fileText.trimEnd()}\n`, "utf8");
        emit(writeOut, repoRoot, { command: "intake new", status: "ok", path: targetRel });
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

  program
    .command("pause")
    .description("Append a pause intervention for a task")
    .argument("<taskId>", "Task id under work/")
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
    .argument("<taskId>", "Task id under work/")
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
    .argument("<taskId>", "Task id under work/")
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
