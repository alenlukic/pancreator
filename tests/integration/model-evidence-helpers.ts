import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  recordSupervisorModelEvidence,
  setRunStage,
} from '../../src/lib/engine.js'
import { resetCursorAgentCapabilities } from '../../src/lib/executors/cursor-probe.js'
import { writeFixtureCursorCatalog } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'
import type { CheckpointVariant } from './delivery-helpers.js'

export const MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  key: 'model-evidence',
  fixture: writeFixtureCursorCatalog,
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(root, runId, 'GPT 5.6 Sol', 'metadata')
  },
}

const VERIFY_MODEL_EVIDENCE_VARIANT: CheckpointVariant = {
  ...MODEL_EVIDENCE_VARIANT,
  key: 'verify-model-evidence',
  afterCreate: (root, runId) => {
    recordSupervisorModelEvidence(root, runId, 'GPT 5.6 Sol', 'metadata')
    setRunStage(root, runId, 'verify', 'Verify the current workspace.')
  },
}

export function preparedRunCheckpoint(variant?: CheckpointVariant) {
  const prepared = checkpoint('delivery@implement-prepared', variant)

  assert.ok(prepared.invocation)

  return {
    root: prepared.root,
    run: prepared.state,
    invocation: prepared.invocation,
  }
}

export function withFakeCursorAgent<T>(
  root: string,
  model: string | null,
  operation: () => T,
): T {
  const bin = path.join(root, 'fake-bin')
  const executable = path.join(bin, 'cursor-agent')
  const priorPath = process.env.PATH

  mkdirSync(bin, { recursive: true })
  writeFileSync(
    executable,
    model
      ? `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({
          type: 'system',
          subtype: 'init',
          model,
        })}'\n`
      : '#!/bin/sh\nexit 0\n',
  )
  chmodSync(executable, 0o755)
  process.env.PATH = `${bin}${path.delimiter}${priorPath ?? ''}`
  // The capability read is cached per process, so each installed fake CLI
  // must start from a clean read.
  resetCursorAgentCapabilities()

  try {
    return operation()
  } finally {
    process.env.PATH = priorPath
    resetCursorAgentCapabilities()
  }
}

/** A marked run standing at the verify stage, which declares two workers. */
export function verifyRun() {
  const { root, run, invocation } = preparedRunCheckpoint(
    VERIFY_MODEL_EVIDENCE_VARIANT,
  )
  assert.equal(invocation.stage.slug, 'verify')
  assert.deepEqual(
    (invocation.evidence_workers ?? []).map((worker) => worker.role),
    ['review', 'qa'],
  )

  return { root, runId: run.run_id, invocation }
}
