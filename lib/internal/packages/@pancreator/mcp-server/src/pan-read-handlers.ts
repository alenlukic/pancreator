import * as path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { asTaskId } from "@pancreator/core";
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
  readonly bootstrap: Record<string, unknown>;
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

export async function listFeatureSummaries(
  ctx: DdlExecutionContext,
): Promise<FeatureListResult> {
  const featuresRoot = path.join(ctx.repoRoot, "lib", "memory", "features");
  const dirs = await safeReaddir(featuresRoot);
  /** @type {FeatureSummary[]} */
  const features = [];
  for (const dirName of dirs) {
    const indexPath = path.posix.join("lib", "memory", "features", dirName, "index.json");
    const index = await readJsonFile(path.join(ctx.repoRoot, indexPath));
    features.push({
      feature_id: String(index?.feature_id ?? dirName),
      title: typeof index?.title === "string" ? index.title : undefined,
      status: typeof index?.status === "string" ? index.status : undefined,
      indexPath,
    });
  }
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
  const featuresRoot = path.join(ctx.repoRoot, "lib", "memory", "features");
  const dirs = await safeReaddir(featuresRoot);
  let matchDir: string | undefined;
  for (const dirName of dirs) {
    const indexPath = path.join(featuresRoot, dirName, "index.json");
    const index = await readJsonFile(indexPath);
    const id = String(index?.feature_id ?? dirName);
    if (id === featureId || dirName === featureId) {
      matchDir = dirName;
      break;
    }
  }
  if (matchDir === undefined) {
    return {
      status: "error",
      command: "feature.show",
      error: `Feature not found: ${featureId}`,
    };
  }
  const indexRel = path.posix.join("lib", "memory", "features", matchDir, "index.json");
  const specRel = path.posix.join("lib", "memory", "features", matchDir, "spec.md");
  const index = (await readJsonFile(path.join(ctx.repoRoot, indexRel))) ?? {};
  let spec: string | undefined;
  try {
    spec = await readFile(path.join(ctx.repoRoot, specRel), "utf8");
  } catch {
    spec = undefined;
  }
  return {
    status: "ok",
    command: "feature.show",
    feature_id: String(index.feature_id ?? featureId),
    index,
    spec,
    citations: [
      {
        kind: "path",
        path: indexRel,
      },
      ...(spec !== undefined
        ? [
            {
              kind: "path",
              path: specRel,
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
  const handbookIndex = path.join(ctx.repoRoot, "lib", "memory", "handbook", "index.md");
  const router = await MemoryRouter.fromIndexFile(handbookIndex);
  const routeHits = router.routeIntent(query, { limit: 5 });
  const hits: MemoryQueryHit[] = routeHits.map((hit) => ({
    tier: "handbook" as const,
    path: hit.primaryPaths[0] ?? hit.secondaryPaths[0] ?? "",
    intent: hit.intent,
    notes: hit.notes,
  }));

  const activeRoot = path.join(ctx.repoRoot, "lib", "memory", "active");
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
    { abs: path.join(repoRoot, "work"), rel: path.posix.join("work") },
    {
      abs: path.join(repoRoot, "archive", "work"),
      rel: path.posix.join("archive", "work"),
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
  const pancreatorYamlPath = path.join(ctx.repoRoot, "pancreator.yaml");
  let bootstrap: Record<string, unknown> = {};
  try {
    bootstrap = parseYaml(await readFile(pancreatorYamlPath, "utf8")) as Record<string, unknown>;
  } catch {
    bootstrap = {};
  }

  const workRoot = path.join(ctx.repoRoot, "work");
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
      bootstrap,
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
    bootstrap,
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
