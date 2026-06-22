import { readdirSync } from "node:fs";
import path from "node:path";
import { invariant } from "./errors.mjs";
import { fileExists, readJson, readText, resolveInside } from "./io.mjs";

const TERMINALS = new Set(["succeeded", "failed", "canceled", "paused"]);
const GATES = new Set(["operator", "supervisor", "next_stage", "stage_verdict"]);
const WORKSPACE_POLICIES = new Set(["source_allowed", "runtime_only", "read_only"]);

/**
 * Load a workflow by slug from its on-disk index and per-stage files.
 * The index (workflow.json) lists ordered stage slugs; each resolves to
 * stages/<slug>.json. The assembled, validated workflow is returned in memory.
 */
export function loadWorkflow(root, slug) {
  const dir = path.join(root, "library", "workflows", slug);
  const indexPath = path.join(dir, "workflow.json");
  invariant(fileExists(indexPath), `Unknown workflow: ${slug}`, { code: "WORKFLOW_NOT_FOUND" });
  const workflow = assembleWorkflow(dir, readJson(indexPath), indexPath);
  validateWorkflow(root, workflow, indexPath);
  return workflow;
}

/**
 * Load an already-assembled workflow file (a per-run workflow.snapshot.json
 * whose stages are full objects, not slug references).
 */
export function loadWorkflowFile(root, filePath) {
  const workflow = readJson(filePath);
  validateWorkflow(root, workflow, filePath);
  return workflow;
}

/** List the slugs of every workflow defined under library/workflows. */
export function listWorkflowSlugs(root) {
  const base = path.join(root, "library", "workflows");
  if (!fileExists(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fileExists(path.join(base, entry.name, "workflow.json")))
    .map((entry) => entry.name)
    .sort();
}

function assembleWorkflow(dir, index, source) {
  invariant(Array.isArray(index.stages) && index.stages.length > 0,
    `${source}: stages must be a non-empty array of stage slugs.`, { code: "INVALID_WORKFLOW" });
  const stages = index.stages.map((slug) => {
    invariant(typeof slug === "string" && slug.length > 0,
      `${source}: each stage entry must be a stage slug string.`, { code: "INVALID_WORKFLOW" });
    const stagePath = path.join(dir, "stages", `${slug}.json`);
    invariant(fileExists(stagePath), `${source}: missing stage file stages/${slug}.json.`, {
      code: "INVALID_WORKFLOW",
    });
    const stage = readJson(stagePath);
    invariant(stage.slug === slug, `stages/${slug}.json: stage slug must equal '${slug}'.`, {
      code: "INVALID_WORKFLOW",
    });
    return stage;
  });
  return { ...index, stages };
}

export function stageBySlug(workflow, slug) {
  const stage = workflow.stages.find((candidate) => candidate.slug === slug);
  invariant(stage, `Workflow ${workflow.slug} has no stage '${slug}'.`, {
    code: "STAGE_NOT_FOUND",
  });
  return stage;
}

export function loadStagePrompt(root, stage) {
  if (typeof stage.prompt === "string") return stage.prompt.trim();
  return readText(resolveInside(root, stage.prompt_path)).trim();
}

export function validateWorkflow(root, workflow, source = "workflow") {
  invariant(workflow?.schema_version === 1, `${source}: schema_version must be 1.`, {
    code: "INVALID_WORKFLOW",
  });
  invariant(typeof workflow.slug === "string" && workflow.slug.length > 0,
    `${source}: slug is required.`, { code: "INVALID_WORKFLOW" });
  invariant(Array.isArray(workflow.stages) && workflow.stages.length > 0,
    `${source}: stages must be a non-empty array.`, { code: "INVALID_WORKFLOW" });
  const slugs = new Set();
  for (const stage of workflow.stages) {
    invariant(typeof stage.slug === "string" && stage.slug.length > 0,
      `${source}: each stage needs a slug.`, { code: "INVALID_WORKFLOW" });
    invariant(!slugs.has(stage.slug), `${source}: duplicate stage '${stage.slug}'.`, {
      code: "INVALID_WORKFLOW",
    });
    slugs.add(stage.slug);
    invariant(typeof stage.persona === "string" && stage.persona.length > 0,
      `${source}: stage '${stage.slug}' needs a persona.`, { code: "INVALID_WORKFLOW" });
    invariant(GATES.has(stage.gate), `${source}: invalid gate '${stage.gate}' in '${stage.slug}'.`, {
      code: "INVALID_WORKFLOW",
    });
    invariant(WORKSPACE_POLICIES.has(stage.workspace_policy),
      `${source}: invalid workspace_policy in '${stage.slug}'.`, { code: "INVALID_WORKFLOW" });
    invariant(
      typeof stage.prompt === "string" || fileExists(resolveInside(root, stage.prompt_path)),
      `${source}: missing prompt '${stage.prompt_path}'.`,
      { code: "INVALID_WORKFLOW" },
    );
    invariant(stage.transitions && typeof stage.transitions === "object",
      `${source}: stage '${stage.slug}' needs transitions.`, { code: "INVALID_WORKFLOW" });
    invariant(Array.isArray(stage.criteria), `${source}: stage '${stage.slug}' needs criteria[].`, {
      code: "INVALID_WORKFLOW",
    });
    const criterionIds = new Set();
    for (const criterion of stage.criteria) {
      invariant(typeof criterion.id === "string" && criterion.id.length > 0,
        `${source}: criterion id missing in '${stage.slug}'.`, { code: "INVALID_WORKFLOW" });
      invariant(!criterionIds.has(criterion.id),
        `${source}: duplicate criterion '${criterion.id}' in '${stage.slug}'.`, {
          code: "INVALID_WORKFLOW",
        });
      criterionIds.add(criterion.id);
      invariant(["judgment", "shell", "state"].includes(criterion.type),
        `${source}: invalid criterion type '${criterion.type}'.`, { code: "INVALID_WORKFLOW" });
      if (criterion.type === "shell") {
        invariant(typeof criterion.command === "string" && criterion.command.length > 0,
          `${source}: shell criterion '${criterion.id}' needs command.`, { code: "INVALID_WORKFLOW" });
      }
    }
  }
  invariant(slugs.has(workflow.start_stage), `${source}: start_stage does not exist.`, {
    code: "INVALID_WORKFLOW",
  });
  for (const stage of workflow.stages) {
    for (const [outcome, target] of Object.entries(stage.transitions)) {
      invariant(["success", "failure", "blocked"].includes(outcome),
        `${source}: unsupported transition outcome '${outcome}'.`, { code: "INVALID_WORKFLOW" });
      invariant(TERMINALS.has(target) || slugs.has(target),
        `${source}: transition '${stage.slug}.${outcome}' targets unknown '${target}'.`, {
          code: "INVALID_WORKFLOW",
        });
    }
  }
  const reachable = new Set();
  const queue = [workflow.start_stage];
  while (queue.length) {
    const slug = queue.shift();
    if (reachable.has(slug)) continue;
    reachable.add(slug);
    const stage = workflow.stages.find((candidate) => candidate.slug === slug);
    for (const target of Object.values(stage.transitions)) {
      if (!TERMINALS.has(target)) queue.push(target);
    }
  }
  invariant(reachable.size === slugs.size,
    `${source}: unreachable stages: ${[...slugs].filter((slug) => !reachable.has(slug)).join(", ")}`,
    { code: "INVALID_WORKFLOW" });
  return workflow;
}
