import * as path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { asTaskId, resolvePancreatorYamlPath, resolveProjectPath, resolveRepoPath } from "@pancreator/core";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@pancreator/intervention";
import { MemoryRouter } from "@pancreator/memory";
import { parse as parseYaml } from "yaml";

import { type DdlExecutionContext } from "./pan-execute.js";

export interface DdlReadEnvelope {
  readonly status: "ok" | "error";
  readonly command: string;
  readonly citations?: readonly Record<string, unknown>[];
}

export interface FeatureSummary {
  readonly feature_id: string;
  readonly category?: string;
  readonly title?: string;
  readonly status?: string;
  readonly indexPath: string;
}

export interface FeatureShowResult extends DdlReadEnvelope {
  readonly status: "ok";
  readonly command: "feature.show";
  readonly feature_id: string;
  readonly index: Record<string, unknown>;
  readonly spec?: string;
}

export interface FeatureListResult extends DdlReadEnvelope {
  readonly status: "ok";
  readonly command: "feature.list";
  readonly features: FeatureSummary[];
}

export interface MemoryQueryHit {
  readonly tier: "handbook" | "active";
  readonly path: string;
  readonly intent?: string;
  readonly excerpt?: string;
  readonly notes?: string;
}

export interface MemoryQueryResult extends DdlReadEnvelope {
  readonly status: "ok";
  readonly command: "memory.query";
  readonly query: string;
  readonly hits: MemoryQueryHit[];
}

export interface WorkspaceStatusResult extends DdlReadEnvelope {
  readonly status: "ok";
  readonly command: "status";
  readonly config: Record<string, unknown>;
  readonly activeTasks: readonly string[];
  readonly task?: Record<string, unknown>;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

async function readJsonFile(absPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(absPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

interface FeatureIndexRecord {
  readonly category?: string;
  readonly dirName: string;
  readonly indexPath: string;
  readonly index: Record<string, unknown>;
}

async function collectFeatureIndexRecords(repoRoot: string): Promise<FeatureIndexRecord[]> {
  const featuresRoot = resolveProjectPath(repoRoot, "lib", "memory", "features");
  const records: FeatureIndexRecord[] = [];

  for (const category of await safeReaddir(featuresRoot)) {
    const categoryRoot = path.join(featuresRoot, category);

    const legacyIndexPath = path.posix.join("lib", "memory", "features", category, "index.json");
    const legacyIndex = await readJsonFile(resolveRepoPath(repoRoot, legacyIndexPath));
    if (legacyIndex?.feature_id !== undefined) {
      records.push({ category: undefined, dirName: category, indexPath: legacyIndexPath, index: legacyIndex });
      continue;
    }

    for (const dirName of await safeReaddir(categoryRoot)) {
      const indexPath = path.posix.join(
        "lib",
        "memory",
        "features",
        category,
        dirName,
        "index.json",
      );
      const index = await readJsonFile(resolveRepoPath(repoRoot, indexPath));
      if (index !== null) {
        records.push({ category, dirName, indexPath, index });
      }
    }
  }

  return records.sort((a, b) => {
    const aId = String(a.index.feature_id ?? a.dirName);
    const bId = String(b.index.feature_id ?? b.dirName);
    return aId.localeCompare(bId);
  });
}

export async function listFeatureSummaries(
  ctx: DdlExecutionContext,
): Promise<FeatureListResult> {
  const features = (await collectFeatureIndexRecords(ctx.repoRoot)).map((record) => ({
    feature_id: String(record.index.feature_id ?? record.dirName),
    category: record.category,
    title: typeof record.index.title === "string" ? record.index.title : undefined,
    status: typeof record.index.status === "string" ? record.index.status : undefined,
    indexPath: record.indexPath,
  }));

  return {
    status: "ok",
    command: "feature.list",
    features,
  };
}

export async function showFeature(
  ctx: DdlExecutionContext,
  featureId: string,
): Promise<FeatureShowResult | { status: "error"; command: "feature.show"; error: string }> {
  const records = await collectFeatureIndexRecords(ctx.repoRoot);
  const match = records.find((record) => {
    const id = String(record.index.feature_id ?? record.dirName);
    return id === featureId || record.dirName === featureId;
  });

  if (match === undefined) {
    return {
      status: "error",
      command: "feature.show",
      error: `Feature not found: ${featureId}`,
    };
  }

  const legacySpecRel = path.posix.join(
    "lib",
    "memory",
    "features",
    ...(match.category !== undefined ? [match.category] : []),
    match.dirName,
    "spec.md",
  );
  let spec: string | undefined;
  try {
    spec = await readFile(resolveRepoPath(ctx.repoRoot, legacySpecRel), "utf8");
  } catch {
    spec = undefined;
  }

  return {
    status: "ok",
    command: "feature.show",
    feature_id: String(match.index.feature_id ?? featureId),
    index: match.index,
    spec,
    citations: [
      {
        kind: "path",
        path: match.indexPath,
      },
      ...(spec !== undefined
        ? [
            {
              kind: "path",
              path: legacySpecRel,
            },
          ]
        : []),
    ],
  };
}

export async function queryMemory(
  ctx: DdlExecutionContext,
  query: string,
): Promise<MemoryQueryResult> {
  const handbookIndex = resolveProjectPath(ctx.repoRoot, "lib", "memory", "handbook", "index.md");
  const router = await MemoryRouter.fromIndexFile(handbookIndex);
  const routeHits = router.routeIntent(query, { limit: 5 });
  const hits: MemoryQueryHit[] = routeHits.map((hit) => ({
    tier: "handbook" as const,
    path: hit.primaryPaths[0] ?? hit.secondaryPaths[0] ?? "",
    intent: hit.intent,
    notes: hit.notes,
  }));

  const activeRoot = resolveProjectPath(ctx.repoRoot, "lib", "memory", "active");
  const activeFiles = ["current.md", "handoffs.md", "README.md"];
  const q = query.toLowerCase();
  for (const name of activeFiles) {
    const rel = path.posix.join("lib", "memory", "active", name);
    const abs = path.join(activeRoot, name);
    try {
      const text = await readFile(abs, "utf8");
      if (text.toLowerCase().includes(q)) {
        const line = text
          .split("\n")
          .find((l) => l.toLowerCase().includes(q));
        hits.push({
          tier: "active",
          path: rel,
          excerpt: line?.trim(),
        });
      }
    } catch {
      /* skip missing active-memory files */
    }
  }

  return {
    status: "ok",
    command: "memory.query",
    query,
    hits,
  };
}

export async function findWorkFile(
  repoRoot: string,
  taskId: string,
  fileName: string,
): Promise<{ abs: string; rel: string } | null> {
  const roots = [
    { abs: resolveProjectPath(repoRoot, ".pan/work"), rel: path.posix.join(".pan/work") },
    {
      abs: resolveProjectPath(repoRoot, ".pan/archive", "work"),
      rel: path.posix.join(".pan/archive", "work"),
    },
  ];
  for (const root of roots) {
    const dayDirs = await safeReaddir(root.abs);
    for (const day of dayDirs) {
      const candidate = path.join(root.abs, day, taskId, fileName);
      try {
        await readFile(candidate, "utf8");
        return {
          abs: candidate,
          rel: path.posix.join(root.rel, day, taskId, fileName),
        };
      } catch {
        /* continue search */
      }
    }
  }
  return null;
}

async function findStateFile(
  repoRoot: string,
  taskId: string,
): Promise<{ abs: string; rel: string } | null> {
  return findWorkFile(repoRoot, taskId, "state.json");
}

export async function readWorkspaceStatus(
  ctx: DdlExecutionContext,
  taskId?: string,
): Promise<WorkspaceStatusResult | { status: "error"; command: "status"; error: string }> {
  const pancreatorYamlPath = resolvePancreatorYamlPath(ctx.repoRoot);
  let config: Record<string, unknown> = {};
  try {
    if (pancreatorYamlPath === undefined) {
      throw new Error("missing pancreator.yaml");
    }
    config = parseYaml(await readFile(pancreatorYamlPath, "utf8")) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const workRoot = resolveProjectPath(ctx.repoRoot, ".pan/work");
  /** @type {string[]} */
  const activeTasks = [];
  for (const day of await safeReaddir(workRoot)) {
    const dayAbs = path.join(workRoot, day);
    for (const task of await safeReaddir(dayAbs)) {
      activeTasks.push(task);
    }
  }

  if (taskId === undefined || taskId === "") {
    return {
      status: "ok",
      command: "status",
      config,
      activeTasks,
    };
  }

  const stateFile = await findStateFile(ctx.repoRoot, taskId);
  if (stateFile === null) {
    return {
      status: "error",
      command: "status",
      error: `No feature-delivery state.json found for task ${taskId}.`,
    };
  }
  const state = JSON.parse(await readFile(stateFile.abs, "utf8")) as Record<string, unknown>;
  const mgr = new InterventionManager(new FsInterventionStore(ctx.repoRoot));
  const interventionState = await mgr.loadActiveState(asTaskId(taskId));
  return {
    status: "ok",
    command: "status",
    config,
    activeTasks,
    task: {
      taskId,
      pipelineId: state.pipelineId,
      featureId: state.featureId,
      currentStage: state.currentStage,
      pipelineStatus: state.status,
      interventionState,
      stateFile: stateFile.rel,
    },
  };
}

export type { CheckpointId };
