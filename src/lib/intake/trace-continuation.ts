/** Content-bound handoff from a classified, operator-approved trace. */
import path from 'node:path'

import { invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
} from '../io.js'
import { loadState, eventPath } from '../state.js'
import type { RunState, StageHistoryItem } from '../types.js'
import { intakeRecordPath, readIntakeRecord } from './record.js'

/** Capture only trace data: terminal finalization may rename output artifacts. */
export function traceContractIdentity(
  root: string,
  state: RunState,
  history: StageHistoryItem,
): NonNullable<StageHistoryItem['trace_contract']> {
  const output = readJson(resolveInside(root, history.output_path))
  invariant(
    isRecord(output) && isRecord(output.data),
    'Trace output has no data.',
    {
      code: 'TRACE_CONTRACT_INVALID',
    },
  )
  const schema = output.data.interface_schema
  invariant(
    isRecord(schema) && typeof schema.path === 'string' && schema.path.trim(),
    'Trace output has no schema path.',
    {
      code: 'TRACE_CONTRACT_INVALID',
    },
  )
  const schemaPath = resolveInside(
    path.resolve(root, state.workspace_root),
    schema.path.trim(),
  )
  invariant(fileExists(schemaPath), `Trace schema is missing: ${schema.path}`, {
    code: 'TRACE_CONTRACT_INVALID',
  })
  return {
    data_sha256: sha256(output.data),
    schema_path: schema.path.trim(),
    schema_sha256: sha256(readText(schemaPath)),
  }
}

/** Refuse drift rather than silently treating current source as the approved schema. */
export function assertTraceContractCurrent(
  root: string,
  state: RunState,
  history: StageHistoryItem,
): NonNullable<StageHistoryItem['trace_contract']> {
  const expected = history.trace_contract
  invariant(
    expected,
    'Trace has no recorded contract identity; submit a new trace.',
    {
      code: 'TRACE_CONTRACT_UNRECORDED',
    },
  )
  const actual = traceContractIdentity(root, state, history)
  invariant(
    actual.data_sha256 === expected.data_sha256 &&
      actual.schema_path === expected.schema_path &&
      actual.schema_sha256 === expected.schema_sha256,
    'Trace output or schema changed after validation; restore it or submit a new trace.',
    { code: 'TRACE_CONTRACT_DRIFT' },
  )
  return expected
}

/** Resolve the next route without mutating the completed run or its original request. */
export function traceContinuation(root: string, runId: string) {
  const state = loadState(root, runId)
  invariant(
    state.workflow_slug === 'prototype-trace' && state.status === 'succeeded',
    'Continuation requires a succeeded prototype-trace run.',
    {
      code: 'TRACE_NOT_APPROVED',
    },
  )
  const history = state.stage_history.at(-1)
  invariant(
    history?.stage === 'trace' && history.outcome === 'success',
    'Trace has no successful output.',
    {
      code: 'TRACE_NOT_APPROVED',
    },
  )
  // A terminal state alone is not approval: explicit stage changes can also end a run.
  const decisions = readText(eventPath(root, runId))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown)
  const approval = decisions
    .reverse()
    .find(
      (event) => isRecord(event) && event.type === 'operator_decision_recorded',
    )
  invariant(
    isRecord(approval) &&
      approval.actor === 'operator' &&
      approval.decision === 'approve' &&
      approval.stage === 'trace',
    'Trace requires explicit operator approval.',
    {
      code: 'TRACE_NOT_APPROVED',
    },
  )
  const contract = assertTraceContractCurrent(root, state, history)
  const record = readIntakeRecord(root, state.request.source_path)
  const route = record?.current.route
  const start = record?.current.start
  invariant(
    record &&
      start?.kind === 'workflow' &&
      start.workflow === 'prototype-trace' &&
      route?.length === 2 &&
      route[0] === 'prototype-trace' &&
      (route[1] === 'standard' || route[1] === 'decompose'),
    'No matching classified trace continuation; inspect the intake record.',
    {
      code: 'TRACE_ROUTE_MISMATCH',
    },
  )
  invariant(
    record.request_sha256 === state.request.sha256 &&
      sha256(readText(resolveInside(root, state.request.stored_path))) ===
        state.request.sha256,
    'The preserved request no longer matches the classified request.',
    {
      code: 'TRACE_REQUEST_DRIFT',
    },
  )
  const workflow = route[1] === 'decompose' ? 'planning' : 'standard'
  invariant(
    fileExists(
      path.join(root, 'library', 'workflows', workflow, 'workflow.json'),
    ),
    `Route workflow ${workflow} is not installed.`,
    {
      code: 'UNKNOWN_WORKFLOW',
    },
  )
  return {
    trace_run_id: runId,
    request: state.request.stored_path,
    classification: path.relative(root, intakeRecordPath(root, record.request)),
    augmented_request: record.augmented_request,
    route: route[1],
    workflow,
    trace_output: history.output_path,
    interface_schema: {
      path: contract.schema_path,
      sha256: contract.schema_sha256,
    },
    workspace: state.workspace_root,
    worktree: state.managed_worktree?.name ?? null,
  }
}
