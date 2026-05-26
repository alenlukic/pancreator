import * as path from "node:path";
import { readFile, readdir } from "node:fs/promises";

import { asTaskId } from "@tesseract/core";
import {
  FsInterventionStore,
  InterventionManager,
  type CheckpointId,
} from "@tesseract/intervention";
import { MemoryRouter } from "@tesseract/memory";
import { parse as parseYaml } from "yaml";

import { type TessExecutionContext } from "./tess-execute.js";

export interface TessReadEnvelope {
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

export interface FeatureShowResult extends TessReadEnvelope {
  readonly status: "ok";
  readonly command: "feature.show";
  readonly feature_id: string;
  readonly index: Record<string, unknown>;
  readonly spec?: string;
}

export interface FeatureListResult extends TessReadEnvelope {
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

export interface MemoryQueryResult extends TessReadEnvelope {
  readonly status: "ok";
  readonly command: "memory.query";
  readonly query: string;
  readonly hits: MemoryQueryHit[];
}

export interface WorkspaceStatusResult extends TessReadEnvelope {
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
  ctx: TessExecutionContext,
): Promise<FeatureListResult> {
  const featuresRoot = path.join(ctx.repoRoot, "src", "memory", "features");
  const dirs = await safeReaddir(featuresRoot);
  /** @type {FeatureSummary[]} */
  const features = [];
  for (const dirName of dirs) {
    const indexPath = path.posix.join("src", "memory", "features", dirName, "index.json");
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
  ctx: TessExecutionContext,
  featureId: string,
): Promise<FeatureShowResult | { status: "error"; command: "feature.show"; error: string }> {
  const featuresRoot = path.join(ctx.repoRoot, "src", "memory", "features");
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
  const indexRel = path.posix.join("src", "memory", "features", matchDir, "index.json");
  const specRel = path.posix.join("src", "memory", "features", matchDir, "spec.md");
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
  ctx: TessExecutionContext,
  query: string,
): Promise<MemoryQueryResult> {
  const handbookIndex = path.join(ctx.repoRoot, "src", "memory", "handbook", "index.md");
  const router = await MemoryRouter.fromIndexFile(handbookIndex);
  const routeHits = router.routeIntent(query, { limit: 5 });
  const hits: MemoryQueryHit[] = routeHits.map((hit) => ({
    tier: "handbook" as const,
    path: hit.primaryPaths[0] ?? hit.secondaryPaths[0] ?? "",
    intent: hit.intent,
    notes: hit.notes,
  }));

  const activeRoot = path.join(ctx.repoRoot, "src", "memory", "active");
  const activeFiles = ["current.md", "handoffs.md", "README.md"];
  const q = query.toLowerCase();
  for (const name of activeFiles) {
    const rel = path.posix.join("src", "memory", "active", name);
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

async function findStateFile(
  repoRoot: string,
  taskId: string,
): Promise<{ abs: string; rel: string } | null> {
  const roots = [
    { abs: path.join(repoRoot, "src", "work"), rel: path.posix.join("src", "work") },
    {
      abs: path.join(repoRoot, "src", "internal", "work_archive"),
      rel: path.posix.join("src", "internal", "work_archive"),
    },
  ];
  for (const root of roots) {
    const dayDirs = await safeReaddir(root.abs);
    for (const day of dayDirs) {
      const candidate = path.join(root.abs, day, taskId, "state.json");
      try {
        await readFile(candidate, "utf8");
        return {
          abs: candidate,
          rel: path.posix.join(root.rel, day, taskId, "state.json"),
        };
      } catch {
        /* continue search */
      }
    }
  }
  return null;
}

export async function readWorkspaceStatus(
  ctx: TessExecutionContext,
  taskId?: string,
): Promise<WorkspaceStatusResult | { status: "error"; command: "status"; error: string }> {
  const tessYamlPath = path.join(ctx.repoRoot, "tesseract.yaml");
  let bootstrap: Record<string, unknown> = {};
  try {
    bootstrap = parseYaml(await readFile(tessYamlPath, "utf8")) as Record<string, unknown>;
  } catch {
    bootstrap = {};
  }

  const workRoot = path.join(ctx.repoRoot, "src", "work");
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
