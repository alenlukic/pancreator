import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { asTaskId } from "@tesseract/core";
import { Command } from "commander";
import { FileInbox } from "@tesseract/inbox";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@tesseract/intervention";
import {
  advanceFeatureDelivery,
  appendFeatureDeliveryInterventionRunLog,
  closeFeatureDeliveryArtifacts,
  readFeatureDeliveryStatusWithInterventions,
  refreshFeatureDeliveryPrompt,
  repairFeatureDeliveryState,
  startFeatureDelivery,
} from "./feature-delivery-run.js";

import { stringifyCliJson } from "./canonical-json-io.js";
import {
  rewriteActiveMemoryFile,
  TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE,
} from "./active-memory-refresh.js";

export { TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE };

/** Stable exit code for deferred stub verbs (`tess init`, MCP deferrals surfaced through the CLI shim, etc.). */
export const TESS_DEFERRED_EXIT_CODE = 125;

/** Fallback when a deferred verb lacks a dedicated intake — mirror `deferredToolTrackingIntake` in `@tesseract/mcp-server/src/tess-execute.ts`. */
const BATCH_DEFERRAL_TRACKING_INTAKE =
  "src/inbox/in/172981_05-25-26/64488_0605_cli-operator-tooling-batch.md";
/** `tess init` / MCP `tess.init` deferral tracker — mirror `deferredToolTrackingIntake` in `@tesseract/mcp-server/src/tess-execute.ts`. */
const TESS_INIT_DEFERRAL_TRACKING_INTAKE =
  "src/inbox/in/172981_05-25-26/64500_0605_tess-init-and-create-tesseract-install-paths.md";

function defaultDeferredTrackingIntake(cliVerb: string): string {
  if (cliVerb === "tess init") {
    return TESS_INIT_DEFERRAL_TRACKING_INTAKE;
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
    exit.code = TESS_DEFERRED_EXIT_CODE;
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
  const active = path.join(repoRoot, "src", "inbox", "in", dayBucket);
  const archived = path.join(repoRoot, "src", "inbox", "archive", "in", dayBucket);
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
  program.name("tess");
  program.description("Tesseract workspace CLI (bootstrap Phase 4).");
  program.configureOutput({
    writeOut: (s: string) => writeOut(s),
    writeErr: (s: string) => writeErr(s),
  });
  program.exitOverride((err: unknown) => {
    throw err;
  });

  program
    .command("init")
    .description("Initialize a Tesseract workspace in the current repository [deferred: M3]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "tess init",
        milestone: "M3",
        manual_workaround:
          "Follow `docs/M1.index.md` adopt flows and manual scaffolding until `tess init` wires installer paths ratified under docs/PRD.md.",
      }),
    );

  program
    .command("run")
    .description("Run a pipeline by name (`feature-delivery` only is executable today) [deferred: M2]")
    .argument("<pipeline>", "Pipeline id")
    .argument("[inboxEntry]", "Inbox file under src/inbox/in/ for feature-delivery")
    .option("--feature <featureId>", "Feature id override")
    .option("--task <taskId>", "Task id override matching <seconds-to-midnight>_<HHMM>_<slug>")
    .action(async (pipeline: string, inboxEntry: string | undefined, opts: { feature?: string; task?: string }) => {
      if (pipeline !== "feature-delivery") {
        emitDeferredEnvelope(writeOut, repoRoot, {
          verb: "tess run",
          milestone: "M2",
          manual_workaround:
            "Bootstrap Phase 4 exposes only `tess feature new`/`tess run feature-delivery <inbox-entry>` orchestration until additional pipelines compile end-to-end per docs/PRD.md.",
        });
        exit.code = TESS_DEFERRED_EXIT_CODE;
        return;
      }
      if (inboxEntry === undefined) {
        throw new Error("feature-delivery requires an inbox entry under src/inbox/in/.");
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
          },
          "run",
        ),
      );
    });

  program
    .command("inbox")
    .description("List pending human directives under src/inbox/in/")
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
    .argument("<inboxEntry>", "Inbox file under src/inbox/in/")
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
          },
          "feature new",
        ),
      );
    });

  program
    .command("status")
    .description("Show pipeline and workspace status [deferred: M2 when task id omitted]")
    .argument("[taskId]", "Task id under src/work/")
    .action(async (taskId: string | undefined) => {
      if (taskId === undefined) {
        emitDeferredEnvelope(writeOut, repoRoot, {
          verb: "tess status",
          milestone: "M2",
          manual_workaround:
            "Pass a Phase-4 feature-delivery task id to read `state.json`; aggregate workspace dashboards remain deferred.",
        });
        exit.code = TESS_DEFERRED_EXIT_CODE;
        return;
      }
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
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
    .argument("<taskId>", "Task id under src/work/")
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
        }),
      );
    });

  program
    .command("repair-state")
    .description("Explicitly repair a feature-delivery ledger after out-of-band manual work")
    .argument("<taskId>", "Task id under src/work/")
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
    .argument("<taskId>", "Task id under src/work/")
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
    .argument("<taskId>", "Task id under src/work/")
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
        verb: "tess approve",
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
        verb: "tess memory",
        milestone: "M2",
        manual_workaround:
          "Orient with `src/memory/handbook/context-economy.md` and read explicit memory files until MemoryRouter CLI surfaces harden.",
      }),
    );

  program
    .command("contracts")
    .description("List or evaluate Spec Contracts [deferred: M2]")
    .action(
      deferredVerbAction(repoRoot, writeOut, exit, {
        verb: "tess contracts",
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
        verb: "tess lint",
        milestone: "M1",
        manual_workaround:
          "Use `pnpm lint`, `pnpm run check:phase0a`, and `bash -n .cursor/hooks/enforce-policy-compliance.sh` locally until tess wraps the bundles.",
      }),
    );

  const intakeCmd = program
    .command("intake")
    .description("Create canonical inbox directives nested under UTC day buckets in src/inbox/in/.");

  intakeCmd
    .command("new")
    .argument("<slug>", "Semantic basename suffix (lowercase slug with hyphens)")
    .description("Emit a templated inbox directive with canonical timestamp prefixes")
    .option("--title <text>", "Directive title shown in Markdown heading and YAML frontmatter", "")
    .option("--owner <persona>", "Owner recorded in YAML frontmatter", "intake-analyst")
    .option("--feature-id <id>", "Feature id retained in YAML frontmatter")
    .option("--from-template <name>", "Use src/memory/handbook/contract-templates/<name>.template.md as the Markdown body scaffold")
    .action(
      async (
        slugArg: string,
        cmdOpts: { title?: string; owner?: string; featureId?: string; fromTemplate?: string },
      ) => {
        const slugOk = /^[a-z0-9][a-z0-9_-]*$/u.test(slugArg);
        if (!slugOk) {
          throw new Error("slug MUST use lowercase letters, digits, underscores, or hyphens starting with alphanumerics.");
        }
        if (!existsSync(path.join(repoRoot, "tesseract.yaml"))) {
          throw new Error("Missing tesseract.yaml at repository root; run from an initialized Tesseract workspace.");
        }
        const now = options?.clock !== undefined ? options.clock() : new Date();
        const dayBucket = makeUtcDayBucket(now);
        if (isArchivedDayBucketCollision(repoRoot, dayBucket)) {
          throw new Error(
            `Refusing to write into archived day-bucket ${dayBucket} because both src/inbox/in and src/inbox/archive/in contain that directory.`,
          );
        }
        const sid = secondsToMidnightUtc(now);
        const hhmm = utcHhmm(now);
        const targetRel = path.posix.join("src/inbox/in", dayBucket, `${sid}_${hhmm}_${slugArg}.md`);
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
            "src/memory/handbook/contract-templates",
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
    .description("Rewrite shipped Feature table and operator-note refresh stamp in src/memory/active/current.md; Active Feature is human-curated")
    .option("--dry-run", "Print the computed diff without writing current.md", false)
    .action(async (cmdOpts: { dryRun?: boolean }) => {
      const dryRun = Boolean(cmdOpts.dryRun);
      const code = await rewriteActiveMemoryFile({
        repoRoot,
        dryRun,
        writeOut,
        writeErr,
        clock: options?.clock ?? (() => new Date()),
      });
      if (code === 0) {
        emit(writeOut, repoRoot, {
          command: "refresh-active-memory",
          status: "ok",
          ...(dryRun ? { dryRun: true } : { path: "src/memory/active/current.md" }),
        });
      }
      exit.code = code;
    });

  program
    .command("pause")
    .description("Append a pause intervention for a task")
    .argument("<taskId>", "Task id under src/work/")
    .action(async (taskId: string) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
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
    .argument("<taskId>", "Task id under src/work/")
    .option(
      "--checkpoint <checkpointId>",
      "Optional checkpoint id for time-travel resume",
    )
    .action(async (taskId: string, opts: { checkpoint?: string }) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
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
    .argument("<taskId>", "Task id under src/work/")
    .option("--reason <text>", "Optional abort reason")
    .action(async (taskId: string, opts: { reason?: string }) => {
      const mgr = new InterventionManager(new FsInterventionStore(repoRoot));
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
    const message = error instanceof Error ? error.message : String(error);
    if (message.length > 0 && !message.startsWith("error:")) {
      emit(writeOut, repoRoot, { command: "error", status: "error", message });
    }
    return 1;
  }
}
