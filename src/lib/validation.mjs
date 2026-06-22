import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { invariant } from "./errors.mjs";
import { fileExists, readJson, resolveInside, sha256, writeTextAtomic } from "./io.mjs";
import { gitWorkspaceSnapshot, snapshotChanged, workspaceDelta } from "./git.mjs";
import { listWorkflowSlugs, loadWorkflow } from "./workflow.mjs";
import { loadPolicyCatalog, resolvePolicies } from "./policies.mjs";

function valueAt(object, dottedPath) {
  return dottedPath.split(".").reduce((value, key) => value?.[key], object);
}

function hasType(value, expected) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  return typeof value === expected;
}

export function validateStageOutput(root, stage, invocation, output) {
  const errors = [];
  if (output?.schema_version !== 1) errors.push("schema_version must be 1");
  if (output?.invocation_id !== invocation.invocation_id) errors.push("invocation_id does not match active invocation");
  if (!["success", "failure", "blocked"].includes(output?.result)) errors.push("result must be success, failure, or blocked");
  if (typeof output?.summary !== "string" || output.summary.trim().length === 0) errors.push("summary is required");
  for (const key of ["artifacts", "criteria", "risks", "unknowns"]) {
    if (!Array.isArray(output?.[key])) errors.push(`${key} must be an array`);
  }
  if (!output?.data || typeof output.data !== "object" || Array.isArray(output.data)) errors.push("data must be an object");

  for (const [dataPath, expectedType] of Object.entries(stage.required_data ?? {})) {
    const value = valueAt(output?.data, dataPath);
    if (!hasType(value, expectedType)) errors.push(`data.${dataPath} must be ${expectedType}`);
  }

  const criteria = new Map();
  for (const item of output?.criteria ?? []) {
    if (typeof item?.id !== "string") {
      errors.push("each criteria item needs id");
      continue;
    }
    if (criteria.has(item.id)) errors.push(`duplicate criteria result: ${item.id}`);
    if (!["pass", "fail", "not_applicable"].includes(item.result)) {
      errors.push(`criteria '${item.id}' has invalid result`);
    }
    if (!Array.isArray(item.evidence)) errors.push(`criteria '${item.id}' evidence must be an array`);
    if (typeof item.explanation !== "string") errors.push(`criteria '${item.id}' explanation is required`);
    criteria.set(item.id, item);
  }
  for (const criterion of stage.criteria) {
    if (!criteria.has(criterion.id)) errors.push(`missing self-evaluation for criterion '${criterion.id}'`);
    const result = criteria.get(criterion.id)?.result;
    if (criterion.hard && result === "not_applicable") errors.push(`hard criterion '${criterion.id}' cannot be not_applicable`);
  }

  for (const artifact of output?.artifacts ?? []) {
    try {
      const absolute = resolveInside(root, artifact.path);
      if (!fileExists(absolute)) errors.push(`artifact does not exist: ${artifact.path}`);
    } catch (error) {
      errors.push(error.message);
    }
    if (typeof artifact.description !== "string" || artifact.description.length === 0) {
      errors.push(`artifact '${artifact.path ?? "unknown"}' needs description`);
    }
  }
  return errors;
}

function runShellCheck(root, runDir, stage, criterion, workspaceFingerprint) {
  const startedAt = new Date().toISOString();
  const result = spawnSync(criterion.command, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    timeout: criterion.timeout_ms ?? 120000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PAN_WORKFLOW_STAGE: stage.slug },
  });
  const evidencePath = path.join(
    runDir,
    "evidence",
    `${stage.slug}-${criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, "-")}.log`,
  );
  const combined = [
    `$ ${criterion.command}`,
    `started_at=${startedAt}`,
    `finished_at=${new Date().toISOString()}`,
    `workspace_fingerprint=${workspaceFingerprint}`,
    `exit_code=${result.status ?? "null"}`,
    result.signal ? `signal=${result.signal}` : null,
    "",
    "--- stdout ---",
    result.stdout ?? "",
    "--- stderr ---",
    result.stderr ?? "",
    result.error ? `--- error ---\n${result.error.message}` : "",
  ].filter((line) => line !== null).join("\n");
  writeTextAtomic(evidencePath, combined);
  return {
    id: criterion.id,
    type: "shell",
    hard: Boolean(criterion.hard),
    passed: result.status === 0 && !result.error,
    command: criterion.command,
    exit_code: result.status,
    timed_out: result.error?.code === "ETIMEDOUT",
    evidence_path: path.relative(root, evidencePath).split(path.sep).join("/"),
    workspace_fingerprint: workspaceFingerprint,
  };
}

function evaluateStateCriterion(state, criterion, workspaceFingerprint) {
  let passed = true;
  let explanation = "No specialized state evaluator was required.";
  if (criterion.id === "ship.prior_gates_current") {
    const review = [...state.stage_history].reverse().find((item) => item.stage === "review" && item.outcome === "success");
    const test = [...state.stage_history].reverse().find((item) => item.stage === "test" && item.outcome === "success");
    passed = Boolean(review && test && test.workspace_fingerprint === workspaceFingerprint);
    explanation = passed
      ? "Review and QA passed, and QA evidence matches the current workspace fingerprint."
      : "Missing passing review/QA evidence or the workspace changed after QA.";
  }
  return {
    id: criterion.id,
    type: "state",
    hard: Boolean(criterion.hard),
    passed,
    explanation,
    workspace_fingerprint: workspaceFingerprint,
  };
}

export function evaluateDeterministicCriteria(root, runDir, state, stage, beforeSnapshot) {
  const afterSnapshot = gitWorkspaceSnapshot(root);
  const results = [];
  if (stage.workspace_policy !== "source_allowed") {
    const changed = snapshotChanged(beforeSnapshot, afterSnapshot);
    results.push({
      id: "scope.no_unapproved_changes",
      type: "state",
      hard: true,
      passed: !changed,
      explanation: changed
        ? "Workspace changed during a stage that does not permit source changes."
        : "Workspace fingerprint is unchanged.",
      delta: changed ? workspaceDelta(beforeSnapshot, afterSnapshot) : { added: [], removed: [] },
      workspace_fingerprint: afterSnapshot.fingerprint,
    });
  }
  for (const criterion of stage.criteria) {
    if (criterion.type === "shell") {
      results.push(runShellCheck(root, runDir, stage, criterion, afterSnapshot.fingerprint));
    } else if (criterion.type === "state") {
      results.push(evaluateStateCriterion(state, criterion, afterSnapshot.fingerprint));
    }
  }
  return { results, workspace: afterSnapshot };
}

export function validateRepository(root) {
  const errors = [];
  const warnings = [];
  const required = [
    "AGENTS.md",
    "package.json",
    "governance/policy_lookup_table.json",
    "library/schemas/stage-output.schema.json",
    "library/schemas/workflow.schema.json",
    "library/schemas/stage.schema.json",
    ".cursor/commands/pan-start.md",
    ".cursor/commands/pan-resume.md",
  ];
  for (const relative of required) {
    if (!fileExists(path.join(root, relative))) errors.push(`missing required file: ${relative}`);
  }
  try {
    const catalog = loadPolicyCatalog(root);
    if (catalog.size === 0) errors.push("policy catalog is empty");
    const lookup = readJson(path.join(root, "governance/policy_lookup_table.json"));
    for (const row of lookup.rows ?? []) {
      for (const id of row.policies ?? []) {
        if (!catalog.has(id)) errors.push(`policy lookup references missing policy: ${id}`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  for (const slug of listWorkflowSlugs(root)) {
    try {
      const workflow = loadWorkflow(root, slug);
      for (const stage of workflow.stages) {
        resolvePolicies(root, { persona: stage.persona, workflow: workflow.slug, stage: stage.slug });
        const personaPath = path.join(root, "library", "personas", `${stage.persona}.md`);
        if (!fileExists(personaPath)) errors.push(`missing persona: library/personas/${stage.persona}.md`);
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  for (const dir of [".cursor/agents", ".cursor/commands", "src/lib"]) {
    const absolute = path.join(root, dir);
    if (fileExists(absolute) && readdirSync(absolute).length === 0) warnings.push(`${dir} is empty`);
  }
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    fingerprint: sha256({ errors, warnings }),
  };
}
