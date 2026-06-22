import { randomUUID } from "node:crypto";
import path from "node:path";
import { invariant } from "./errors.mjs";
import {
  appendJsonLine,
  fileExists,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from "./io.mjs";

/** Current time as an ISO 8601 string. */
export function now() {
  return new Date().toISOString();
}

/** Generate a sortable, unique run id from the current timestamp. */
export function makeRunId() {
  return `${new Date().toISOString().replaceAll(/[-:.]/g, "")}-${randomUUID().slice(0, 8)}`;
}

/** Absolute path to a run's directory under runtime/logs/workflows. */
export function runDir(root, runId) {
  return path.join(root, "runtime", "logs", "workflows", runId);
}

/** Absolute path to a run's materialized state file. */
export function statePath(root, runId) {
  return path.join(runDir(root, runId), "state.json");
}

/** Absolute path to a run's append-only event log. */
export function eventPath(root, runId) {
  return path.join(runDir(root, runId), "events.jsonl");
}

/** Absolute path to a run's exclusive lock file. */
export function lockPath(root, runId) {
  return path.join(runDir(root, runId), ".lock");
}

/**
 * Load a run's materialized state, recovering from a newer write-ahead event if
 * the last event carries a higher revision than state.json (interrupted write).
 */
export function loadState(root, runId) {
  const filePath = statePath(root, runId);
  invariant(fileExists(filePath), `Unknown run: ${runId}`, { code: "RUN_NOT_FOUND" });
  let state = readJson(filePath);
  const eventsFile = eventPath(root, runId);
  if (fileExists(eventsFile)) {
    const lines = readText(eventsFile).trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      const latest = JSON.parse(lines.at(-1));
      if (latest.state_after?.revision > state.revision) {
        state = latest.state_after;
        writeJsonAtomic(filePath, state);
      }
    }
  }
  return state;
}

/**
 * Advance the state revision, append an event with the full post-state, and
 * atomically replace state.json. Also mirrors a compact line to the
 * orchestrator-wide event log.
 */
export function persist(root, state, eventType, payload = {}) {
  state.revision += 1;
  state.updated_at = now();
  const event = {
    schema_version: 1,
    event_id: randomUUID(),
    type: eventType,
    timestamp: state.updated_at,
    run_id: state.run_id,
    revision: state.revision,
    ...payload,
    state_after: structuredClone(state),
  };
  appendJsonLine(eventPath(root, state.run_id), event);
  writeJsonAtomic(statePath(root, state.run_id), state);
  appendJsonLine(path.join(root, "runtime", "logs", "orchestrator", "events.jsonl"), {
    timestamp: state.updated_at,
    run_id: state.run_id,
    type: eventType,
    status: state.status,
    stage: state.current_stage,
  });
}

/**
 * Write an operator-facing decision record for a pause/escalation and point the
 * state at it. Returns the repository-relative path.
 */
export function writeDecision(root, state, title, reasoning, actionItems = []) {
  const decision = {
    $operator: {
      headline: title,
      status: "paused",
      next_action: actionItems[0] ?? "Inspect the run and decide how to continue.",
    },
    schema_version: 1,
    decision_id: randomUUID(),
    timestamp: now(),
    run_id: state.run_id,
    stage: state.current_stage,
    title,
    reasoning,
    action_items: actionItems,
  };
  const relative = `runtime/logs/workflows/${state.run_id}/decisions/${decision.decision_id}.json`;
  writeJsonAtomic(resolveInside(root, relative), decision);
  state.last_decision_path = relative;
  return relative;
}
