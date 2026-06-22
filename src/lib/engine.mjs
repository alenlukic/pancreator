import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import path from "node:path";
import { invariant } from "./errors.mjs";
import {
  ensureDir,
  fileExists,
  readJson,
  readText,
  resolveInside,
  sha256,
  toRepoRelative,
  withFileLock,
  writeJsonAtomic,
  writeTextAtomic,
} from "./io.mjs";
import { gitWorkspaceSnapshot } from "./git.mjs";
import { resolvePolicies } from "./policies.mjs";
import { renderInvocationMarkdown, renderStatus, renderTaskRecord } from "./render.mjs";
import {
  lockPath,
  loadState,
  makeRunId,
  now,
  persist,
  runDir,
  writeDecision,
} from "./state.mjs";
import { evaluateDeterministicCriteria, validateStageOutput } from "./validation.mjs";
import { loadStagePrompt, loadWorkflow, loadWorkflowFile, stageBySlug } from "./workflow.mjs";

function loadRunWorkflow(root, state) {
  return loadWorkflowFile(root, resolveInside(root, state.workflow_snapshot.path));
}

function referencesForRun(root, state) {
  const refs = [
    { path: state.request.stored_path, description: "Original operator request" },
  ];
  for (const item of state.stage_history) {
    if (item.output_path) refs.push({ path: item.output_path, description: `${item.stage} stage output (${item.outcome})` });
    if (item.record_path) refs.push({ path: item.record_path, description: `${item.stage} execution record` });
  }
  return refs.filter((item, index, all) => all.findIndex((other) => other.path === item.path) === index);
}

function pauseForLimit(root, state, reason) {
  state.status = "paused";
  state.pause_reason = reason;
  state.pending_action = { type: "operator_decision" };
  writeDecision(root, state, "Workflow paused by circuit breaker", reason, [
    `Resume from a chosen stage with: ./bin/pan resume ${state.run_id} --stage <stage>`,
    `Or abort with: ./bin/pan abort ${state.run_id}`,
  ]);
}

function applyTransition(root, state, workflow, stage, outcome) {
  state.transition_count += 1;
  state.consecutive_failures = outcome === "failure" ? state.consecutive_failures + 1 : 0;
  const target = stage.transitions[outcome];
  invariant(target, `Stage '${stage.slug}' has no '${outcome}' transition.`, {
    code: "INVALID_TRANSITION",
  });

  if (state.transition_count > state.limits.max_total_transitions) {
    pauseForLimit(root, state, "Maximum workflow transitions exceeded.");
    return;
  }
  if (state.consecutive_failures > state.limits.max_consecutive_failures) {
    pauseForLimit(root, state, "Maximum consecutive failures exceeded.");
    return;
  }
  if (["succeeded", "failed", "canceled"].includes(target)) {
    state.status = target;
    state.current_stage = null;
    state.pending_action = { type: "none" };
    return;
  }
  if (target === "paused") {
    state.status = "paused";
    state.pause_reason = `Stage '${stage.slug}' reported ${outcome}.`;
    state.pending_action = { type: "operator_decision" };
    writeDecision(root, state, "Workflow needs operator input", state.pause_reason, [
      `Resume with: ./bin/pan resume ${state.run_id}`,
    ]);
    return;
  }
  state.status = "running";
  state.current_stage = target;
  state.pending_action = { type: "prepare_invocation" };
  state.current_invocation = null;
}

export function createRun(root, { workflowSlug = "dev", requestPath, title = null }) {
  invariant(requestPath, "--request is required.", { code: "REQUEST_REQUIRED" });
  const workflow = loadWorkflow(root, workflowSlug);
  const source = resolveInside(root, requestPath);
  invariant(fileExists(source), `Request file does not exist: ${requestPath}`, { code: "REQUEST_NOT_FOUND" });
  const id = makeRunId();
  const dir = runDir(root, id);
  for (const child of ["invocations", "outputs", "assessments", "evidence", "records", "decisions", "artifacts"]) {
    ensureDir(path.join(dir, child));
  }
  const requestExtension = path.extname(source) || ".md";
  const storedRequest = `runtime/logs/workflows/${id}/request${requestExtension}`;
  copyFileSync(source, resolveInside(root, storedRequest));
  const workflowSnapshot = `runtime/logs/workflows/${id}/workflow.snapshot.json`;
  const workflowSnapshotValue = structuredClone(workflow);
  for (const stage of workflowSnapshotValue.stages) {
    stage.prompt = loadStagePrompt(root, stage);
    stage.prompt_sha256 = sha256(stage.prompt);
  }
  writeJsonAtomic(resolveInside(root, workflowSnapshot), workflowSnapshotValue);
  const state = {
    schema_version: 1,
    run_id: id,
    workflow_slug: workflow.slug,
    workflow_snapshot: { path: workflowSnapshot, sha256: sha256(workflowSnapshotValue) },
    title: title ?? path.basename(requestPath),
    status: "running",
    current_stage: workflow.start_stage,
    pending_action: { type: "prepare_invocation" },
    current_invocation: null,
    request: {
      source_path: toRepoRelative(root, source),
      stored_path: storedRequest,
      sha256: sha256(readText(source)),
    },
    limits: workflow.limits,
    attempts: {},
    transition_count: 0,
    consecutive_failures: 0,
    stage_history: [],
    revision: 0,
    created_at: now(),
    updated_at: now(),
  };
  persist(root, state, "run_created", { workflow: workflow.slug });
  return state;
}

export function prepareInvocation(root, runId) {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    invariant(state.status === "running", `Run is not running: ${state.status}`, { code: "RUN_NOT_RUNNING" });
    if (state.pending_action?.type === "invoke_agent" && state.current_invocation) {
      return { state, invocation: readJson(resolveInside(root, state.current_invocation.json_path)) };
    }
    invariant(state.pending_action?.type === "prepare_invocation", "Run is not ready to prepare an invocation.", {
      code: "INVALID_RUN_ACTION",
      details: { pending: state.pending_action },
    });
    const workflow = loadRunWorkflow(root, state);
    const stage = stageBySlug(workflow, state.current_stage);
    const attempt = (state.attempts[stage.slug] ?? 0) + 1;
    if (attempt > state.limits.max_stage_attempts) {
      pauseForLimit(root, state, `Stage '${stage.slug}' exceeded ${state.limits.max_stage_attempts} attempts.`);
      persist(root, state, "run_paused", { reason: state.pause_reason });
      return { state, invocation: null };
    }
    state.attempts[stage.slug] = attempt;
    const invocationId = `${stage.slug}-${attempt}-${randomUUID().slice(0, 8)}`;
    const outputPath = `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`;
    const jsonPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.json`;
    const markdownPath = `runtime/logs/workflows/${runId}/invocations/${invocationId}.md`;
    const workspace = gitWorkspaceSnapshot(root);
    const policies = resolvePolicies(root, {
      persona: stage.persona,
      workflow: workflow.slug,
      stage: stage.slug,
    });
    const invocation = {
      $operator: {
        headline: `${stage.title} is ready`,
        summary: `The harness prepared attempt ${attempt} with ${policies.length} scoped policies and a workspace fingerprint.`,
        next_action: stage.persona === "orchestrator"
          ? `Complete this stage in the current chat, write ${outputPath}, then submit it.`
          : `Invoke the '${stage.persona}' Cursor subagent with this card, then submit ${outputPath}.`,
      },
      schema_version: 1,
      invocation_id: invocationId,
      run_id: runId,
      attempt,
      created_at: now(),
      workflow: { slug: workflow.slug, snapshot_path: state.workflow_snapshot.path, snapshot_sha256: state.workflow_snapshot.sha256 },
      stage: {
        slug: stage.slug,
        title: stage.title,
        persona: stage.persona,
        model_hint: stage.model_hint,
        workspace_policy: stage.workspace_policy,
        gate: stage.gate,
      },
      prompt: loadStagePrompt(root, stage),
      inputs: { references: referencesForRun(root, state) },
      policies,
      rubric: stage.criteria,
      output: {
        path: outputPath,
        template: "library/templates/stage-output.example.json",
        schema: "library/schemas/stage-output.schema.json",
        required_data: stage.required_data ?? {},
      },
      boundaries: [
        "Read this invocation card before any broader repository context.",
        `Respect workspace policy '${stage.workspace_policy}'.`,
        "Write only the declared output shape and evidence; do not alter workflow state directly.",
        "Do not commit, push, merge, publish, deploy, or perform destructive source-control actions.",
      ],
      workspace_before: workspace,
    };
    writeJsonAtomic(resolveInside(root, jsonPath), invocation);
    writeTextAtomic(resolveInside(root, markdownPath), renderInvocationMarkdown(invocation));
    state.current_invocation = { id: invocationId, json_path: jsonPath, markdown_path: markdownPath, output_path: outputPath };
    state.pending_action = { type: "invoke_agent", persona: stage.persona, path: markdownPath };
    persist(root, state, "invocation_prepared", { invocation_id: invocationId, stage: stage.slug, attempt });
    return { state, invocation };
  });
}

function effectiveOutcome(stage, output, validationErrors, deterministic) {
  if (validationErrors.length > 0) return "failure";
  if (output.result === "blocked") return "blocked";
  if (output.result === "failure") return "failure";
  const self = new Map(output.criteria.map((item) => [item.id, item]));
  if (stage.criteria.some((criterion) => criterion.hard && self.get(criterion.id)?.result === "fail")) return "failure";
  if (deterministic.some((item) => item.hard && !item.passed)) return "failure";
  return "success";
}

export function submitOutput(root, runId, submittedPath) {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    const output = readJson(resolveInside(root, submittedPath));
    const existing = state.stage_history.find((item) => item.invocation_id === output.invocation_id);
    if (existing?.record_path) {
      const recordPath = existing.record_path.replace(/\.md$/u, ".json");
      return { state, record: readJson(resolveInside(root, recordPath)), idempotent: true };
    }
    invariant(state.status === "running", `Run is not running: ${state.status}`, { code: "RUN_NOT_RUNNING" });
    invariant(state.pending_action?.type === "invoke_agent", "Run is not awaiting stage output.", { code: "INVALID_RUN_ACTION" });
    const workflow = loadRunWorkflow(root, state);
    const stage = stageBySlug(workflow, state.current_stage);
    const invocation = readJson(resolveInside(root, state.current_invocation.json_path));
    const validationErrors = validateStageOutput(root, stage, invocation, output);
    writeJsonAtomic(resolveInside(root, state.current_invocation.output_path), output);
    const evaluated = evaluateDeterministicCriteria(root, runDir(root, runId), state, stage, invocation.workspace_before);
    const outcome = effectiveOutcome(stage, output, validationErrors, evaluated.results);
    const historyItem = {
      stage: stage.slug,
      attempt: invocation.attempt,
      invocation_id: invocation.invocation_id,
      output_path: state.current_invocation.output_path,
      outcome,
      submitted_at: now(),
      workspace_fingerprint: evaluated.workspace.fingerprint,
      validation_errors: validationErrors,
      deterministic: evaluated.results,
    };
    state.stage_history.push(historyItem);

    let nextState;
    if (outcome === "success" && stage.gate === "supervisor") {
      const assessmentId = `assessment-${invocation.invocation_id}`;
      const assessmentPath = `runtime/logs/workflows/${runId}/assessments/${assessmentId}.json`;
      const cardPath = `runtime/logs/workflows/${runId}/assessments/${assessmentId}.request.json`;
      writeJsonAtomic(resolveInside(root, cardPath), {
        $operator: { headline: `${stage.title} needs supervisor evaluation`, status: "awaiting_evaluation", next_action: `Write ${assessmentPath} and run pan assess.` },
        schema_version: 1,
        assessment_id: assessmentId,
        invocation_id: invocation.invocation_id,
        run_id: runId,
        stage: stage.slug,
        output_path: state.current_invocation.output_path,
        criteria: stage.criteria.filter((criterion) => criterion.type === "judgment"),
        deterministic_results: evaluated.results,
        required_output_path: assessmentPath,
      });
      state.pending_action = { type: "supervisor_assessment", path: cardPath, output_path: assessmentPath };
      state.status = "awaiting_supervisor";
      nextState = "awaiting supervisor evaluation";
    } else if (outcome === "success" && stage.gate === "operator") {
      state.pending_action = { type: "operator_approval", stage: stage.slug, proposed_transition: stage.transitions.success };
      state.status = "awaiting_operator";
      nextState = "awaiting operator approval";
    } else {
      applyTransition(root, state, workflow, stage, outcome);
      nextState = state.status === "running" ? state.current_stage : state.status;
    }

    const record = {
      schema_version: 1,
      run_id: runId,
      invocation_id: invocation.invocation_id,
      stage: { slug: stage.slug, title: stage.title, persona: stage.persona },
      outcome,
      summary: output.summary,
      artifacts: output.artifacts,
      risks: output.risks,
      unknowns: output.unknowns,
      evaluation: { validation_errors: validationErrors, deterministic: evaluated.results, self: output.criteria },
      workspace_fingerprint: evaluated.workspace.fingerprint,
      next_state: nextState,
      timestamp: now(),
    };
    const recordBase = `runtime/logs/workflows/${runId}/records/${invocation.invocation_id}`;
    writeJsonAtomic(resolveInside(root, `${recordBase}.json`), record);
    writeTextAtomic(resolveInside(root, `${recordBase}.md`), renderTaskRecord(record));
    historyItem.record_path = `${recordBase}.md`;
    persist(root, state, "stage_output_submitted", { stage: stage.slug, invocation_id: invocation.invocation_id, outcome, next_state: nextState });
    return { state, record };
  });
}

export function assessStage(root, runId, assessmentPath) {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    invariant(state.status === "awaiting_supervisor" && state.pending_action?.type === "supervisor_assessment",
      "Run is not awaiting supervisor assessment.", { code: "INVALID_RUN_ACTION" });
    const assessment = readJson(resolveInside(root, assessmentPath));
    invariant(assessment.schema_version === 1, "Assessment schema_version must be 1.", { code: "INVALID_ASSESSMENT" });
    invariant(assessment.invocation_id === state.current_invocation.id, "Assessment invocation_id mismatch.", { code: "INVALID_ASSESSMENT" });
    invariant(["pass", "fail", "escalate"].includes(assessment.verdict), "Assessment verdict must be pass, fail, or escalate.", { code: "INVALID_ASSESSMENT" });
    const workflow = loadRunWorkflow(root, state);
    const stage = stageBySlug(workflow, state.current_stage);
    writeJsonAtomic(resolveInside(root, state.pending_action.output_path), assessment);
    if (assessment.verdict === "escalate") {
      state.status = "paused";
      state.pause_reason = assessment.summary;
      state.pending_action = { type: "operator_decision" };
      writeDecision(root, state, "Supervisor escalated a judgment", assessment.summary, assessment.action_items ?? []);
    } else {
      state.status = "running";
      applyTransition(root, state, workflow, stage, assessment.verdict === "pass" ? "success" : "failure");
    }
    persist(root, state, "supervisor_assessment_recorded", { stage: stage.slug, verdict: assessment.verdict });
    return { state, assessment };
  });
}

export function decideRun(root, runId, decision, note = "") {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    invariant(state.status === "awaiting_operator" && state.pending_action?.type === "operator_approval",
      "Run is not awaiting operator approval.", { code: "INVALID_RUN_ACTION" });
    invariant(["approve", "reject"].includes(decision), "Decision must be approve or reject.", { code: "INVALID_DECISION" });
    const workflow = loadRunWorkflow(root, state);
    const stage = stageBySlug(workflow, state.current_stage);
    state.status = "running";
    applyTransition(root, state, workflow, stage, decision === "approve" ? "success" : "failure");
    persist(root, state, "operator_decision_recorded", { stage: stage.slug, decision, note });
    return state;
  });
}

export function resumeRun(root, runId, stageSlug = null) {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    invariant(state.status === "paused", "Only paused runs can be resumed.", { code: "INVALID_RUN_ACTION" });
    const workflow = loadRunWorkflow(root, state);
    const target = stageSlug ?? state.current_stage ?? workflow.start_stage;
    stageBySlug(workflow, target);
    state.status = "running";
    state.current_stage = target;
    state.pending_action = { type: "prepare_invocation" };
    state.current_invocation = null;
    state.pause_reason = null;
    state.consecutive_failures = 0;
    persist(root, state, "run_resumed", { stage: target });
    return state;
  });
}

export function abortRun(root, runId, note = "") {
  return withFileLock(lockPath(root, runId), () => {
    const state = loadState(root, runId);
    invariant(!["succeeded", "failed", "canceled"].includes(state.status), "Run is already terminal.", { code: "RUN_TERMINAL" });
    state.status = "canceled";
    state.current_stage = null;
    state.pending_action = { type: "none" };
    persist(root, state, "run_canceled", { note });
    return state;
  });
}

export function getRunStatus(root, runId, { json = false } = {}) {
  const state = loadState(root, runId);
  return json ? state : renderStatus(state);
}

export function getRunState(root, runId) {
  return loadState(root, runId);
}
