import { resolveProjectPath, resolveRepoPath } from "@pancreator/core";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { stringifyCliJson } from "./canonical-json-io.js";
import { pruneEmptyQueueParents } from "./inbox-archive.js";
import { parseSimpleYaml } from "./simple-yaml.js";
import {
  listCanonicalWorkDayDirs,
  listTaskDirNames,
} from "./work-archive-hygiene.js";

const INBOX_IN_PREFIX = "lib/inbox/in/";
const ARCHIVE_INBOX_IN_PREFIX = ".pan/archive/inbox/in/";
const WORK_ROOT = ".pan/work";
const ARCHIVE_WORK_ROOT = ".pan/archive/work";

/** Retention window for completed experience-planning runs without a feature-delivery child. */
export const EXPERIENCE_PLANNING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ExperiencePlanningState {
  taskId: string;
  featureId?: string;
  pipelineId?: string;
  pipeline?: string;
  stageId?: string;
  currentStage?: string;
  status?: string;
  createdAt?: string;
  completedAt?: string;
  synthesizedDirective?: string;
  outputs?: {
    synthesizedDirective?: string;
  };
  source?: {
    inboxPath?: string;
  };
  archivedAt?: string;
  archivedReason?: string;
}

interface FeatureDeliveryInboxLink {
  taskId: string;
  status: string;
  currentStage: string;
  runDirRel: string;
  inboxPath: string;
  archived: boolean;
}

export interface ExperiencePlanningRetentionResult {
  archived: string[];
  removed: string[];
}

function normalizeRel(value: string): string {
  return value.replace(/\\/gu, "/").replace(/^\/+/, "");
}

function parseFrontmatter(content: string): Record<string, unknown> {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    return {};
  }
  return parseSimpleYaml(content.slice(4, end)) as Record<string, unknown>;
}

export function isExperiencePlanningState(
  parsed: Record<string, unknown>,
): boolean {
  return (
    parsed.pipelineId === "experience-planning" ||
    parsed.pipeline === "experience-planning"
  );
}

export function readSynthesizedDirective(
  state: ExperiencePlanningState,
): string | undefined {
  const directive =
    state.outputs?.synthesizedDirective ?? state.synthesizedDirective;
  if (typeof directive !== "string" || directive.trim().length === 0) {
    return undefined;
  }
  return normalizeRel(directive);
}

function inboxBasename(inboxRel: string): string {
  return path.posix.basename(normalizeRel(inboxRel));
}

function inboxPathsMatch(left: string, right: string): boolean {
  const leftNorm = normalizeRel(left);
  const rightNorm = normalizeRel(right);
  if (leftNorm === rightNorm) {
    return true;
  }
  return inboxBasename(leftNorm) === inboxBasename(rightNorm);
}

function archivedInboxRelForActive(inboxRel: string): string {
  const norm = normalizeRel(inboxRel);
  if (!norm.startsWith(INBOX_IN_PREFIX)) {
    return norm;
  }
  return path.posix.join(
    ARCHIVE_INBOX_IN_PREFIX.replace(/\/+$/u, ""),
    norm.slice(INBOX_IN_PREFIX.length),
  );
}

async function readOptionalText(abs: string): Promise<string | null> {
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readDirectiveContent(
  repoRoot: string,
  inboxRel: string,
): Promise<string | null> {
  const norm = normalizeRel(inboxRel);
  const candidates = new Set<string>([norm]);
  if (norm.startsWith(INBOX_IN_PREFIX)) {
    candidates.add(archivedInboxRelForActive(norm));
  }
  if (norm.startsWith(ARCHIVE_INBOX_IN_PREFIX)) {
    candidates.add(
      path.posix.join(
        INBOX_IN_PREFIX.replace(/\/+$/u, ""),
        norm.slice(ARCHIVE_INBOX_IN_PREFIX.length),
      ),
    );
  }
  for (const rel of candidates) {
    const content = await readOptionalText(resolveRepoPath(repoRoot, rel));
    if (content !== null) {
      return content;
    }
  }
  return null;
}

export function resolveExperiencePlanningTaskFromDirective(
  directiveContent: string,
): string | null {
  const frontmatter = parseFrontmatter(directiveContent);
  const sourcePipeline = frontmatter.source_pipeline;
  const sourceTask = frontmatter.source_task;
  if (sourcePipeline !== "experience-planning") {
    return null;
  }
  if (typeof sourceTask !== "string" || sourceTask.trim().length === 0) {
    return null;
  }
  return sourceTask.trim();
}

async function readExperiencePlanningState(
  stateAbs: string,
): Promise<ExperiencePlanningState | null> {
  try {
    const parsed = JSON.parse(
      await readFile(stateAbs, "utf8"),
    ) as Record<string, unknown>;
    if (!isExperiencePlanningState(parsed)) {
      return null;
    }
    return parsed as unknown as ExperiencePlanningState;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readFeatureDeliveryInboxLink(
  stateAbs: string,
  runDirRel: string,
  archived: boolean,
): Promise<FeatureDeliveryInboxLink | null> {
  try {
    const parsed = JSON.parse(
      await readFile(stateAbs, "utf8"),
    ) as Record<string, unknown>;
    if (parsed.pipelineId !== "feature-delivery") {
      return null;
    }
    const source = parsed.source;
    if (
      source === null ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      typeof (source as { inboxPath?: unknown }).inboxPath !== "string"
    ) {
      return null;
    }
    const inboxPath = normalizeRel(
      (source as { inboxPath: string }).inboxPath,
    );
    return {
      taskId: String(parsed.taskId ?? ""),
      status: String(parsed.status ?? ""),
      currentStage: String(parsed.currentStage ?? ""),
      runDirRel,
      inboxPath,
      archived,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function listActiveExperiencePlanningRuns(
  repoRoot: string,
): Promise<
  Array<{
    runDirRel: string;
    state: ExperiencePlanningState;
    stateAbs: string;
  }>
> {
  const workRootAbs = resolveProjectPath(repoRoot, WORK_ROOT);
  const runs: Array<{
    runDirRel: string;
    state: ExperiencePlanningState;
    stateAbs: string;
  }> = [];
  const dayDirs = await listCanonicalWorkDayDirs(workRootAbs);
  for (const dayDir of dayDirs) {
    const dayAbs = path.join(workRootAbs, dayDir);
    for (const taskId of await listTaskDirNames(dayAbs)) {
      const runDirRel = path.posix.join(WORK_ROOT, dayDir, taskId);
      const stateAbs = path.join(dayAbs, taskId, "state.json");
      const state = await readExperiencePlanningState(stateAbs);
      if (state === null) {
        continue;
      }
      runs.push({ runDirRel, state, stateAbs });
    }
  }
  return runs;
}

async function findExperiencePlanningRunDir(
  repoRoot: string,
  taskId: string,
): Promise<{ runDirRel: string; active: boolean } | null> {
  for (const rootRel of [WORK_ROOT, ARCHIVE_WORK_ROOT] as const) {
    const rootAbs = resolveProjectPath(repoRoot, rootRel);
    const dayDirs = await listCanonicalWorkDayDirs(rootAbs);
    for (const dayDir of dayDirs) {
      const runDirRel = path.posix.join(rootRel, dayDir, taskId);
      const runAbs = resolveRepoPath(repoRoot, runDirRel);
      if (existsSync(path.join(runAbs, "state.json"))) {
        return { runDirRel, active: rootRel === WORK_ROOT };
      }
    }
  }
  return null;
}

async function listFeatureDeliveryInboxLinks(
  repoRoot: string,
): Promise<FeatureDeliveryInboxLink[]> {
  const links: FeatureDeliveryInboxLink[] = [];
  for (const [rootRel, archived] of [
    [WORK_ROOT, false],
    [ARCHIVE_WORK_ROOT, true],
  ] as const) {
    const rootAbs = resolveProjectPath(repoRoot, rootRel);
    const dayDirs = await listCanonicalWorkDayDirs(rootAbs);
    for (const dayDir of dayDirs) {
      const dayAbs = path.join(rootAbs, dayDir);
      for (const taskId of await listTaskDirNames(dayAbs)) {
        const runDirRel = path.posix.join(rootRel, dayDir, taskId);
        const stateAbs = path.join(dayAbs, taskId, "state.json");
        const link = await readFeatureDeliveryInboxLink(
          stateAbs,
          runDirRel,
          archived,
        );
        if (link !== null) {
          links.push(link);
        }
      }
    }
  }
  return links;
}

export async function findFeatureDeliveryRunForDirective(
  repoRoot: string,
  directiveRel: string,
): Promise<FeatureDeliveryInboxLink | null> {
  const norm = normalizeRel(directiveRel);
  const links = await listFeatureDeliveryInboxLinks(repoRoot);
  return (
    links.find((link) => inboxPathsMatch(link.inboxPath, norm)) ?? null
  );
}

function featureDeliveryIsArchived(link: FeatureDeliveryInboxLink): boolean {
  return (
    link.archived ||
    link.status === "closed" ||
    link.runDirRel.startsWith(`${ARCHIVE_WORK_ROOT}/`)
  );
}

async function resolveExperiencePlanningAgeMs(
  repoRoot: string,
  state: ExperiencePlanningState,
  stateAbs: string,
  now: Date,
): Promise<number> {
  const timestamp = state.completedAt ?? state.createdAt;
  if (typeof timestamp === "string" && timestamp.length > 0) {
    const parsed = Date.parse(timestamp);
    if (!Number.isNaN(parsed)) {
      return Math.max(0, now.getTime() - parsed);
    }
  }
  const fileStat = await stat(stateAbs);
  return Math.max(0, now.getTime() - fileStat.mtimeMs);
}

export async function archiveExperiencePlanningRun(
  repoRoot: string,
  runDirRel: string,
  reason: string,
  now: Date = new Date(),
): Promise<string> {
  const norm = normalizeRel(runDirRel);
  const parts = norm.split("/");
  if (
    parts.length !== 4 ||
    parts[0] !== ".pan" ||
    parts[1] !== "work"
  ) {
    throw new Error(
      `experience-planning run MUST be active under .pan/work/<day>/<task-id>; got ${runDirRel}.`,
    );
  }
  const archiveRunRel = path.posix.join(
    ARCHIVE_WORK_ROOT,
    parts[2]!,
    parts[3]!,
  );
  const activeAbs = resolveRepoPath(repoRoot, norm);
  const archiveAbs = resolveRepoPath(repoRoot, archiveRunRel);
  if (!existsSync(activeAbs)) {
    if (existsSync(archiveAbs)) {
      return archiveRunRel;
    }
    throw new Error(`Missing active experience-planning run ${norm}.`);
  }
  if (existsSync(archiveAbs)) {
    throw new Error(
      `Archive experience-planning run already exists: ${archiveRunRel}.`,
    );
  }

  const stateAbs = path.join(activeAbs, "state.json");
  const state = await readExperiencePlanningState(stateAbs);
  if (state === null) {
    throw new Error(`Missing experience-planning state at ${norm}/state.json.`);
  }
  state.status = "closed";
  state.archivedAt = now.toISOString();
  state.archivedReason = reason;

  await mkdir(path.dirname(archiveAbs), { recursive: true });
  await rename(activeAbs, archiveAbs);
  await writeFile(
    path.join(archiveAbs, "state.json"),
    stringifyCliJson(repoRoot, state),
    "utf8",
  );
  await pruneEmptyQueueParents(
    repoRoot,
    path.posix.dirname(norm),
    WORK_ROOT,
  );
  return archiveRunRel;
}

export async function removeExperiencePlanningRun(
  repoRoot: string,
  runDirRel: string,
): Promise<void> {
  const norm = normalizeRel(runDirRel);
  const activeAbs = resolveRepoPath(repoRoot, norm);
  if (!existsSync(activeAbs)) {
    return;
  }
  await rm(activeAbs, { recursive: true, force: true });
  await pruneEmptyQueueParents(
    repoRoot,
    path.posix.dirname(norm),
    WORK_ROOT,
  );
}

export async function archiveExperiencePlanningForClosedFeatureDelivery(
  repoRoot: string,
  featureDeliveryInboxRel: string,
  now: Date = new Date(),
): Promise<string[]> {
  const directiveContent = await readDirectiveContent(
    repoRoot,
    featureDeliveryInboxRel,
  );
  if (directiveContent === null) {
    return [];
  }
  const sourceTask =
    resolveExperiencePlanningTaskFromDirective(directiveContent);
  if (sourceTask === null) {
    return [];
  }
  const epRun = await findExperiencePlanningRunDir(repoRoot, sourceTask);
  if (epRun === null || !epRun.active) {
    return [];
  }
  const archivedRunRel = await archiveExperiencePlanningRun(
    repoRoot,
    epRun.runDirRel,
    `Archived after linked feature-delivery inbox closure (${normalizeRel(featureDeliveryInboxRel)}).`,
    now,
  );
  return [archivedRunRel];
}

export async function sweepExperiencePlanningWorkRetention(
  repoRoot: string,
  options?: { clock?: () => Date },
): Promise<ExperiencePlanningRetentionResult> {
  const now = options?.clock?.() ?? new Date();
  const archived: string[] = [];
  const removed: string[] = [];
  const activeRuns = await listActiveExperiencePlanningRuns(repoRoot);

  for (const { runDirRel, state, stateAbs } of activeRuns) {
    const directiveRel = readSynthesizedDirective(state);
    const linkedFd =
      directiveRel === undefined
        ? null
        : await findFeatureDeliveryRunForDirective(repoRoot, directiveRel);

    if (linkedFd !== null) {
      if (featureDeliveryIsArchived(linkedFd)) {
        const archivedRunRel = await archiveExperiencePlanningRun(
          repoRoot,
          runDirRel,
          `Archived after linked feature-delivery run ${linkedFd.taskId} reached terminal archival.`,
          now,
        );
        archived.push(archivedRunRel);
      }
      continue;
    }

    const ageMs = await resolveExperiencePlanningAgeMs(
      repoRoot,
      state,
      stateAbs,
      now,
    );
    if (ageMs >= EXPERIENCE_PLANNING_RETENTION_MS) {
      await removeExperiencePlanningRun(repoRoot, runDirRel);
      removed.push(runDirRel);
    }
  }

  return { archived, removed };
}
