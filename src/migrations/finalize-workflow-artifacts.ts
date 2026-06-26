import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { invariant } from '../lib/errors.js'
import { findProjectRoot } from '../lib/io.js'
import {
  isClosedRunStatus,
  rewriteWorkflowArtifacts,
  type WorkflowArtifactRewriteSummary,
} from '../lib/workflow-artifacts.js'
import { loadState } from '../lib/state.js'
import type { RunState } from '../lib/types.js'

export function finalizeWorkflowArtifacts(
  root: string,
  runId: string,
  activeState?: RunState,
): WorkflowArtifactRewriteSummary {
  const state = activeState ?? loadState(root, runId)

  invariant(isClosedRunStatus(state.status), 'Run is not closed.', {
    code: 'RUN_NOT_TERMINAL',
  })

  return rewriteWorkflowArtifacts(root, runId, 'completed', state)
}

const directEntry = process.argv[1]

if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  const runId = process.argv[2]

  if (!runId) {
    throw new Error('Usage: finalize-workflow-artifacts <run-id> [root]')
  }

  const root = process.argv[3]
    ? path.resolve(process.argv[3])
    : findProjectRoot()
  const summary = finalizeWorkflowArtifacts(root, runId)

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}
