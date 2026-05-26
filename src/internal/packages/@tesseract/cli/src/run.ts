import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
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

/** Stable exit code for deferred stub verbs (`tess init`, MCP deferrals surfaced through the CLI shim, etc.). */
export const TESS_DEFERRED_EXIT_CODE = 125;

/** Exit code used when computed active-memory slices disagree with observed content. */
export const TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE = 126;

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

const OPS_NOTES_AUTO_START = "<!-- tess:active-memory:operator-notes:auto -->";
const OPS_NOTES_AUTO_END = "<!-- /tess:active-memory:operator-notes:auto -->";

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

interface ActiveMemorySlices {
  activeFeatureBody: string;
  shippedFeaturesBody: string;
  managedOperatorNotesSlice: string;
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

async function listMarkdownLeaves(absDir: string, relPrefix: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string, dirAbs: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return;
      }
      throw e;
    }
    for (const ent of entries) {
      if (ent.name.startsWith(".")) continue;
      const relPath = rel === "" ? ent.name : `${rel}/${ent.name}`;
      const absChild = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        await walk(relPath, absChild);
      } else if (ent.name.endsWith(".md")) {
        out.push(relPrefix ? `${relPrefix}/${relPath}` : relPath);
      }
    }
  }
  await walk("", absDir);
  return out;
}

async function deriveNewestInboxDirective(repoRoot: string): Promise<string> {
  const inboxIn = path.join(repoRoot, "src", "inbox", "in");
  const files = await listMarkdownLeaves(inboxIn, "src/inbox/in");
  const cand = files.filter((f) => !f.endsWith(".gitkeep"));
  if (cand.length === 0) return "`(none)`";
  const stamped = await Promise.all(
    cand.map(async (rel) => ({
      rel,
      mtime: (await stat(path.join(repoRoot, rel))).mtimeMs,
    })),
  );
  stamped.sort((a, b) => {
    if (b.mtime !== a.mtime) return b.mtime - a.mtime;
    return a.rel.localeCompare(b.rel);
  });
  return `\`${stamped[0]!.rel}\``;
}

interface IndexedShipRow {
  featureId: string;
  completedAtMs: number;
  row: string;
}

function parseShippedAtMs(rec: Record<string, unknown>): number | null {
  const index = rec["index"];
  const handoff = rec["handoff"];
  const delivery = rec["delivery_report"];

  let candidate: unknown;
  if (index && typeof index === "object") {
    const idx = index as Record<string, unknown>;
    candidate = idx["completed_at"];
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    candidate =
      handoff && typeof handoff === "object"
        ? (handoff as Record<string, unknown>)["completed_at"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    const ship = rec["shipped"];
    candidate =
      ship && typeof ship === "object"
        ? (ship as Record<string, unknown>)["shipped_at_utc"]
        : undefined;
  }
  if (typeof candidate !== "string" || Number.isNaN(Date.parse(candidate))) {
    candidate =
      delivery && typeof delivery === "object"
        ? (delivery as Record<string, unknown>)["staged_at_utc"]
        : undefined;
  }
  if (typeof candidate !== "string") {
    return null;
  }
  const ms = Date.parse(candidate);
  return Number.isNaN(ms) ? null : ms;
}

function truncateCell(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}…`;
}

function readDeliverySectionObject(rec: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = rec["delivery_report"];
  return raw !== undefined && typeof raw === "object" ? (raw as Record<string, unknown>) : undefined;
}

function readDeliveryReportPath(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["path"] === "string") return top["path"] as string;
  const handoff = rec["handoff"];
  if (handoff && typeof handoff === "object" && typeof (handoff as Record<string, unknown>)["delivery_report"] === "string") {
    return (handoff as Record<string, unknown>)["delivery_report"] as string;
  }
  const arts = rec["artifacts"];
  if (Array.isArray(arts)) {
    for (const item of arts) {
      if (item && typeof item === "object") {
        const role = (item as Record<string, unknown>)["role"];
        const pth = (item as Record<string, unknown>)["path"];
        if (role === "delivery-report" && typeof pth === "string") {
          return pth;
        }
      }
    }
  }
  return "";
}

function readOutboxStagingPath(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["staged_to_inbox_out"] === "string") {
    return top["staged_to_inbox_out"] as string;
  }
  const ship = rec["shipped"];
  if (ship && typeof ship === "object" && typeof (ship as Record<string, unknown>)["outbox_artifact"] === "string") {
    return (ship as Record<string, unknown>)["outbox_artifact"] as string;
  }
  const notifier = rec["notifier"];
  if (notifier && typeof notifier === "object" && typeof (notifier as Record<string, unknown>)["outbox_artifact"] === "string") {
    return (notifier as Record<string, unknown>)["outbox_artifact"] as string;
  }
  return "";
}

function readArchivedInboxPointer(rec: Record<string, unknown>): string {
  const top = readDeliverySectionObject(rec);
  if (top !== undefined && typeof top["archived_inbox_source"] === "string") {
    return top["archived_inbox_source"] as string;
  }
  const ship = rec["shipped"];
  if (ship && typeof ship === "object" && typeof (ship as Record<string, unknown>)["archived_inbox_source"] === "string") {
    return (ship as Record<string, unknown>)["archived_inbox_source"] as string;
  }
  const notifier = rec["notifier"];
  if (
    notifier &&
    typeof notifier === "object" &&
    typeof (notifier as Record<string, unknown>)["inbox_source_archived_to"] === "string"
  ) {
    return (notifier as Record<string, unknown>)["inbox_source_archived_to"] as string;
  }
  return "";
}

async function deriveShippedMarkdownTable(repoRoot: string): Promise<string> {
  const featuresRoot = path.join(repoRoot, "src", "memory", "features");
  let dirs: string[] = [];
  try {
    dirs = (await readdir(featuresRoot, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return "\n(No indexed features discovered.)\n";
  }

  const rows: IndexedShipRow[] = [];

  for (const dirName of dirs) {
    const indexPath = path.join(featuresRoot, dirName, "index.json");
    if (!existsSync(indexPath)) continue;
    const rawText = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const statusRaw = parsed["status"];
    const isIndexed = statusRaw === "indexed";

    const featureIdRoot = parsed["feature_id"];
    const featureIdCamel = parsed["featureId"];
    const featureId =
      typeof featureIdRoot === "string"
        ? featureIdRoot
        : typeof featureIdCamel === "string"
          ? featureIdCamel
          : dirName;
    const completedAtMs = parseShippedAtMs(parsed);

    const deliveryRel = readDeliveryReportPath(parsed);

    const outboxArtifact = readOutboxStagingPath(parsed);
    const archivedSrc = readArchivedInboxPointer(parsed);

    let row = "";

    const deliveryPathStyled = deliveryRel !== "" ? `\`${truncateCell(deliveryRel, 120)}\`` : "`—`";
    const outboxStyled = outboxArtifact !== "" ? `\`${truncateCell(outboxArtifact, 120)}\`` : "`—`";
    const archivedStyled =
      archivedSrc !== "" ? `\`${truncateCell(archivedSrc, 120)}\`` : "`—`";

    if (isIndexed) {
      row = `| \`${featureId}\` | [indexed] (${completedAtMs !== null ? `\`${new Date(completedAtMs).toISOString()}\`` : "`—`"}) | ${deliveryPathStyled} | ${outboxStyled} | ${archivedStyled} |`;
    }

    rows.push({
      featureId,
      completedAtMs: completedAtMs ?? 0,
      row,
    });
  }

  const indexedRows = rows.filter((r) => r.row !== "");
  indexedRows.sort((a, b) => {
    if (b.completedAtMs !== a.completedAtMs) return b.completedAtMs - a.completedAtMs;
    return a.featureId.localeCompare(b.featureId);
  });

  let table =
    "| Feature | Shipped at (UTC) | Delivery report | Outbox artifact | Archived source |\n|---|---|---|---|---|\n";
  if (indexedRows.length === 0) {
    table += "| `—` | `—` | `—` | `—` | `—` |\n";
  } else {
    for (const r of indexedRows) {
      table += `${r.row}\n`;
    }
  }
  return `\n${table}`;
}

function buildManagedOperatorSlice(nowUtcIso: string): string {
  return [
    OPS_NOTES_AUTO_START,
    "",
    `- Active-memory refreshed (UTC): \`${nowUtcIso}\``,
    "",
    OPS_NOTES_AUTO_END,
    "",
  ].join("\n");
}

function replaceOperatorNotesAutomation(fullSection: string, managedSlice: string): string {
  const startIdx = fullSection.indexOf(OPS_NOTES_AUTO_START);
  const endIdx = fullSection.indexOf(OPS_NOTES_AUTO_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    return (
      fullSection.slice(0, startIdx) +
      managedSlice.trimEnd() +
      "\n" +
      fullSection.slice(endIdx + OPS_NOTES_AUTO_END.length)
    );
  }
  return `\n${managedSlice}\n${fullSection.replace(/^\s*\n/u, "")}`;
}

function getSectionInner(source: string, headingTitle: string): string {
  const header = `## ${headingTitle}\n`;
  const idx = source.indexOf(header);
  if (idx === -1) {
    throw new Error(`Heading "## ${headingTitle}" is missing from current.md`);
  }
  const innerStart = idx + header.length;
  const tail = source.slice(innerStart);
  const relNext = tail.search(/\n## /u);
  const innerEnd = relNext === -1 ? source.length : innerStart + relNext;
  return source.slice(innerStart, innerEnd);
}

function replaceSectionInner(source: string, headingTitle: string, newInner: string): string {
  const header = `## ${headingTitle}\n`;
  const idx = source.indexOf(header);
  if (idx === -1) {
    throw new Error(`Heading "## ${headingTitle}" is missing from current.md`);
  }
  const innerStart = idx + header.length;
  const tail = source.slice(innerStart);
  const relNext = tail.search(/\n## /u);
  const innerEnd = relNext === -1 ? source.length : innerStart + relNext;
  return `${source.slice(0, innerStart)}${newInner}${source.slice(innerEnd)}`;
}

function normalizeSectionInner(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Neutralizes timestamp drift inside tess-managed operator-notes markers before conflict comparisons. */
function canonicalizeManagedOperatorNotesAuto(inner: string): string {
  const startIdx = inner.indexOf(OPS_NOTES_AUTO_START);
  const endIdx = inner.indexOf(OPS_NOTES_AUTO_END);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const afterAuto = endIdx + OPS_NOTES_AUTO_END.length;
    return `${inner.slice(0, startIdx)}\n<tess:auto-managed-operator-notes />\n${inner.slice(afterAuto)}`;
  }
  return inner;
}

function operatorNotesSectionConflictFree(observed: string, rebuilt: string): boolean {
  return (
    normalizeSectionInner(canonicalizeManagedOperatorNotesAuto(observed)) ===
    normalizeSectionInner(canonicalizeManagedOperatorNotesAuto(rebuilt))
  );
}

async function computeActiveMemorySlicesAsync(repoRootAbs: string, now: Date): Promise<ActiveMemorySlices> {
  const activeBullet = `- ${await deriveNewestInboxDirective(repoRootAbs)}\n`;
  const activeFeatureBody = `\n${activeBullet}\n`;
  const iso = now.toISOString();
  const managedOperatorNotesSlice = buildManagedOperatorSlice(iso);
  const shippedFeaturesBody = await deriveShippedMarkdownTable(repoRootAbs);
  return { activeFeatureBody, shippedFeaturesBody, managedOperatorNotesSlice };
}

function diffSlices(label: string, observed: string, computed: string): string {
  if (normalizeSectionInner(observed) === normalizeSectionInner(computed)) return "";
  return `Section ${JSON.stringify(label)}:\n--- observed\n${observed}\n+++ computed\n${computed}\n`;
}

async function rewriteActiveMemoryFile(opts: {
  readonly repoRoot: string;
  readonly dryRun: boolean;
  readonly writeOut: (c: string) => void;
  readonly writeErr?: (c: string) => void;
  readonly clock: () => Date;
}): Promise<number> {
  const repoRootAbs = path.resolve(opts.repoRoot);
  const currentRel = "src/memory/active/current.md";
  const currentAbs = path.join(repoRootAbs, currentRel);
  if (!existsSync(currentAbs)) {
    throw new Error(`Missing active memory file ${currentRel}`);
  }
  const raw = await readFile(currentAbs, "utf8");
  const now = opts.clock();

  const activeObserved = getSectionInner(raw, "Active Feature");
  const shippedObserved = getSectionInner(raw, "Most recent shipped Features");
  const notesObserved = getSectionInner(raw, "Operator notes");

  const slices = await computeActiveMemorySlicesAsync(repoRootAbs, now);
  const rebuiltNotesSection = replaceOperatorNotesAutomation(notesObserved, slices.managedOperatorNotesSlice);

  const diffChunks: string[] = [];
  const activeChunk = diffSlices("## Active Feature", activeObserved, slices.activeFeatureBody);
  if (activeChunk) diffChunks.push(activeChunk);
  const shippedChunk = diffSlices("## Most recent shipped Features", shippedObserved, slices.shippedFeaturesBody);
  if (shippedChunk) diffChunks.push(shippedChunk);
  const notesChunk = operatorNotesSectionConflictFree(notesObserved, rebuiltNotesSection)
    ? ""
    : diffSlices("## Operator notes", notesObserved, rebuiltNotesSection);
  if (notesChunk) diffChunks.push(notesChunk);

  const combinedDiff = diffChunks.join("\n");
  if (combinedDiff.length > 0) {
    opts.writeOut(`${combinedDiff}\n`);
  }

  if (opts.dryRun) {
    if (diffChunks.length > 0) {
      if (opts.writeErr !== undefined) {
        opts.writeErr(
          "Active-memory refresh dry-run: labeled sections diverge from derived values; inspect stdout diff.\n",
        );
      }
      return TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
    }
    emit(opts.writeOut, opts.repoRoot, { command: "refresh-active-memory", status: "ok", dryRun: true });
    return 0;
  }

  if (diffChunks.length > 0) {
    if (opts.writeErr !== undefined) {
      opts.writeErr("Active-memory refresh halted: resolve conflicts or pass --dry-run to preview.\n");
    }
    return TESS_ACTIVE_MEMORY_CONFLICT_EXIT_CODE;
  }

  const assembled = replaceSectionInner(
    replaceSectionInner(
      replaceSectionInner(raw, "Active Feature", slices.activeFeatureBody),
      "Most recent shipped Features",
      slices.shippedFeaturesBody,
    ),
    "Operator notes",
    rebuiltNotesSection,
  );
  await writeFile(currentAbs, assembled, "utf8");
  emit(opts.writeOut, opts.repoRoot, { command: "refresh-active-memory", status: "ok", path: currentRel });
  return 0;
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
    .description("Rewrite Active Feature, shipped Feature table, and operator-note refresh stamp in src/memory/active/current.md")
    .option("--dry-run", "Print the computed diff without writing current.md", false)
    .action(async (cmdOpts: { dryRun?: boolean }) => {
      exit.code = await rewriteActiveMemoryFile({
        repoRoot,
        dryRun: Boolean(cmdOpts.dryRun),
        writeOut,
        writeErr,
        clock: options?.clock ?? (() => new Date()),
      });
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
