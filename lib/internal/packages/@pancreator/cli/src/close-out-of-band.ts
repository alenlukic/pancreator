import { asTaskId, resolveRepoPath } from "@pancreator/core";
import { appendRunLogRecord, rfc3339UtcMs } from "@pancreator/run-logger";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";
import {
  FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
  type FeatureDeliveryState,
} from "./feature-delivery-run.js";
import {
  ensureOperatorVerificationDoc,
  OPERATOR_VERIFICATION_FILENAME,
  operatorVerificationRel,
} from "./operator-verification.js";

const OUT_OF_BAND_MANIFEST = "out-of-band.manifest.json";

export interface CloseOutOfBandInput {
  repoRoot: string;
  runDirRel: string;
  featureId: string;
  reason: string;
  inboxSourceRel?: string;
  scaffoldVerification?: boolean;
  clock?: () => Date;
}

export interface CloseOutOfBandResult {
  command: "close-out-of-band";
  status: "ok";
  taskId: string;
  featureId: string;
  archivedRunDir: string;
  operatorVerificationFile: string;
  stateFile: string;
  inboxArchivedPath?: string;
}

function normalizeRunDirRel(value: string): string {
  const norm = value.replace(/\\/gu, "/").replace(/^\/+/, "");
  const parts = norm.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[0] !== ".pan" || parts[1] !== "work") {
    throw new Error(`run directory MUST be .pan/work/<day>/<task-id>; got ${value}.`);
  }
  for (const segment of parts) {
    if (segment === "." || segment === "..") {
      throw new Error(`run directory MUST NOT contain dot segments; got ${value}.`);
    }
  }
  return parts.join("/");
}

function parseRunDir(runDirRel: string): { dayDir: string; taskId: string } {
  const [, , dayDir, taskId] = runDirRel.split("/");
  return { dayDir: dayDir!, taskId: taskId! };
}

function archiveInboxPathForSource(sourceRel: string, dayDir: string, taskId: string): string {
  const prefix = "lib/inbox/in/";
  if (!sourceRel.startsWith(prefix)) {
    throw new Error(`inbox source MUST be under ${prefix}; got ${sourceRel}.`);
  }
  const tail = sourceRel.slice(prefix.length);
  const basename = path.posix.basename(tail);
  return path.posix.join(".pan/archive", "inbox", "in", dayDir, taskId, basename);
}

async function assertExistingDirectory(abs: string, rel: string): Promise<void> {
  if (!existsSync(abs)) {
    throw new Error(`Required directory is missing: ${rel}.`);
  }
}

async function assertPathMissing(abs: string, rel: string): Promise<void> {
  if (existsSync(abs)) {
    throw new Error(`Path already exists: ${rel}.`);
  }
}

async function removeEmptyDirectoryIfPresent(abs: string, rel: string): Promise<void> {
  try {
    const { readdir, rmdir } = await import("node:fs/promises");
    const entries = await readdir(abs);
    if (entries.length === 0) {
      await rmdir(abs);
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") {
      throw new Error(`Failed to remove empty directory ${rel}: ${err.message}`);
    }
  }
}

function buildMinimalOutOfBandState(input: {
  taskId: string;
  featureId: string;
  runDirRel: string;
  inboxSourceRel: string;
  now: Date;
}): FeatureDeliveryState {
  const stateFileRel = path.posix.join(input.runDirRel, "state.json");
  return {
    schemaVersion: FEATURE_DELIVERY_STATE_SCHEMA_VERSION,
    pipelineId: "out-of-band",
    taskId: input.taskId,
    featureId: input.featureId,
    status: "complete",
    currentStage: "complete",
    createdAtIso: rfc3339UtcMs(input.now),
    source: {
      inboxEntry: path.posix.basename(input.inboxSourceRel),
      inboxPath: input.inboxSourceRel,
    },
    artifacts: {
      runDir: input.runDirRel,
      stateFile: stateFileRel,
      handoffFile: path.posix.join(input.runDirRel, "handoff.md"),
      runLogFile: path.posix.join(input.runDirRel, "run.log.jsonl"),
      nextPromptFile: path.posix.join(input.runDirRel, "next-prompt.md"),
      operatorVerificationFile: path.posix.join(input.runDirRel, OPERATOR_VERIFICATION_FILENAME),
    },
    stages: [],
    transitions: [],
    nextHumanAction: "Out-of-band workspace closed; operator verification pack is archived for human execution.",
  };
}

export async function closeOutOfBandWorkspace(input: CloseOutOfBandInput): Promise<CloseOutOfBandResult> {
  const repoRoot = path.resolve(input.repoRoot);
  const now = input.clock?.() ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 12) {
    throw new Error("close-out-of-band requires --reason with at least 12 characters.");
  }

  const runDirRel = normalizeRunDirRel(input.runDirRel);
  const { dayDir, taskId } = parseRunDir(runDirRel);
  const featureId = input.featureId.trim();
  if (featureId.length === 0) {
    throw new Error("close-out-of-band requires --feature <feature-id>.");
  }

  const activeRunAbs = resolveRepoPath(repoRoot, runDirRel);
  const archiveRunRel = path.posix.join(".pan/archive", "work", dayDir, taskId);
  const archiveRunAbs = resolveRepoPath(repoRoot, archiveRunRel);

  await assertExistingDirectory(activeRunAbs, runDirRel);
  await assertPathMissing(archiveRunAbs, archiveRunRel);

  const verificationRel = operatorVerificationRel({ artifacts: { runDir: runDirRel } });
  const verificationAbs = resolveRepoPath(repoRoot, verificationRel);
  if (!existsSync(verificationAbs)) {
    if (input.scaffoldVerification === true) {
      await ensureOperatorVerificationDoc(repoRoot, { taskId, featureId, artifacts: { runDir: runDirRel } }, now);
    } else {
      throw new Error(`Missing required artifact ${verificationRel}; author it before close-out-of-band.`);
    }
  }

  const manifestAbs = path.join(activeRunAbs, OUT_OF_BAND_MANIFEST);
  const manifest = existsSync(manifestAbs)
    ? (JSON.parse(await readFile(manifestAbs, "utf8")) as Record<string, unknown>)
    : {};
  manifest["reason"] = typeof manifest["reason"] === "string" && manifest["reason"].trim().length >= 12
    ? manifest["reason"]
    : reason;
  manifest["closed_at"] = rfc3339UtcMs(now);
  manifest["feature_id"] = featureId;
  await writeFile(manifestAbs, stringifyCliJson(repoRoot, manifest), "utf8");

  const inboxSourceRel =
    input.inboxSourceRel?.replace(/\\/gu, "/").replace(/^\/+/, "") ??
    path.posix.join("lib", "inbox", "in", `${featureId}.md`);

  const statePathAbs = path.join(activeRunAbs, "state.json");
  let state: FeatureDeliveryState;
  if (existsSync(statePathAbs)) {
    state = JSON.parse(await readFile(statePathAbs, "utf8")) as FeatureDeliveryState;
    state.status = "complete";
    state.currentStage = "complete";
    state.featureId = featureId;
    state.artifacts.operatorVerificationFile = verificationRel;
  } else {
    state = buildMinimalOutOfBandState({ taskId, featureId, runDirRel, inboxSourceRel, now });
    await writeFile(statePathAbs, stringifyCliJson(repoRoot, state), "utf8");
  }

  let inboxArchivedPath: string | undefined;
  const inboxSourceAbs = resolveRepoPath(repoRoot, inboxSourceRel);
  const inboxArchiveRel = archiveInboxPathForSource(inboxSourceRel, dayDir, taskId);
  const inboxArchiveAbs = resolveRepoPath(repoRoot, inboxArchiveRel);
  if (existsSync(inboxSourceAbs) && !existsSync(inboxArchiveAbs)) {
    await mkdir(path.dirname(inboxArchiveAbs), { recursive: true });
    await rename(inboxSourceAbs, inboxArchiveAbs);
    inboxArchivedPath = inboxArchiveRel;
    state.source.inboxPath = inboxSourceRel;
  }

  await mkdir(path.dirname(archiveRunAbs), { recursive: true });
  await rename(activeRunAbs, archiveRunAbs);
  await removeEmptyDirectoryIfPresent(path.dirname(activeRunAbs), path.posix.dirname(runDirRel));

  state.status = "closed";
  state.artifacts = {
    runDir: archiveRunRel,
    stateFile: path.posix.join(archiveRunRel, "state.json"),
    handoffFile: path.posix.join(archiveRunRel, "handoff.md"),
    runLogFile: path.posix.join(archiveRunRel, "run.log.jsonl"),
    nextPromptFile: path.posix.join(archiveRunRel, "next-prompt.md"),
    operatorVerificationFile: path.posix.join(archiveRunRel, OPERATOR_VERIFICATION_FILENAME),
  };
  state.advanceHistory = [
    ...(state.advanceHistory ?? []),
    {
      atIso: rfc3339UtcMs(now),
      kind: "close",
      from: "complete",
      to: "complete",
      event: "out_of_band_closed",
      artifact: archiveRunRel,
      reason,
    },
  ];
  state.nextHumanAction =
    "Out-of-band closure complete; execute operator-verification.md and reopen with pan reopen when verification fails.";

  await writeFile(path.join(archiveRunAbs, "state.json"), stringifyCliJson(repoRoot, state), "utf8");

  const runLogAbs = path.join(archiveRunAbs, "run.log.jsonl");
  if (existsSync(runLogAbs)) {
    await appendRunLogRecord(runLogAbs, {
      ts: rfc3339UtcMs(now),
      trace_id: "0000000000000000",
      span_id: "00000000",
      name: "pancreator.pipeline.close_out_of_band",
      kind: "event",
      status: { code: "OK" },
      attributes: {
        "pancreator.feature_id": featureId,
        "pancreator.task_id": taskId,
      },
      resource: { "service.name": "pancreator", "service.version": "0.0.0" },
      pancreator: {
        task_id: asTaskId(taskId),
        pipeline: state.pipelineId,
        stage_id: "complete",
        outcome: "success",
        checkpoint_seq: state.advanceHistory?.length ?? 0,
        token_usage_unavailable: true,
      },
    });
  }

  return {
    command: "close-out-of-band",
    status: "ok",
    taskId,
    featureId,
    archivedRunDir: archiveRunRel,
    operatorVerificationFile: state.artifacts.operatorVerificationFile!,
    stateFile: state.artifacts.stateFile,
    ...(inboxArchivedPath !== undefined ? { inboxArchivedPath } : {}),
  };
}
