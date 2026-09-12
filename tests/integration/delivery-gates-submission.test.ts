import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import {
  checkpoint,
  checksVariant,
  submitStageOutput,
} from './delivery-helpers.js'
import { createTestTempDirectory } from '../temp.js'

test('a failed hard self-criterion skips shell gates on a declared success', () => {
  const { root, runId, workflow } = checkpoint('delivery@implement-prepared')
  const implementStage = stageBySlug(workflow, 'implement')

  const submitted = submitStageOutput(root, runId, implementStage, 'success', [
    'implement.acceptance_claimed',
  ])

  assert.equal(submitted.record.outcome, 'failure')

  const shellResults = submitted.record.evaluation.deterministic.filter(
    (item) => item.type === 'shell',
  )

  assert.ok(shellResults.length >= 2)
  for (const result of shellResults) {
    assert.equal(result.skipped, true)
    assert.equal(result.passed, true)
    assert.equal(result.exit_code, undefined)
    assert.match(
      result.explanation ?? '',
      /hard criterion 'implement\.acceptance_claimed' was self-evaluated as failed/u,
    )
  }
})

test('a failed read attestation skips shell gates before executing them', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
  )
  const implementStage = stageBySlug(workflow, 'implement')

  assert.ok(invocation)

  const output = makeOutput(root, invocation, implementStage)

  assert.ok(output.invocation_attestation)
  assert.ok(output.invocation_attestation.status === 'read')
  output.invocation_attestation.contract_sha256 = '0'.repeat(64)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'failure')

  const shellResults = submitted.record.evaluation.deterministic.filter(
    (item) => item.type === 'shell',
  )

  assert.ok(shellResults.length >= 2)
  for (const result of shellResults) {
    assert.equal(result.skipped, true)
    assert.match(
      result.explanation ?? '',
      /the invocation read attestation failed/u,
    )
  }
})

test('a retry may submit a merge-patch revision instead of the whole document', () => {
  const {
    root,
    runId,
    state: first,
    workflow,
  } = checkpoint('delivery@implement-failed-once')
  const implementStage = stageBySlug(workflow, 'implement')
  const firstHistory = first.stage_history[0]
  const firstInvocationId = firstHistory.invocation_id
  const firstOutput = JSON.parse(
    readFileSync(path.join(root, firstHistory.output_path), 'utf8'),
  ) as Record<string, Record<string, unknown>>

  assert.equal(firstHistory.outcome, 'failure')
  assert.equal(first.current_stage, 'implement')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  assert.equal(invocation.attempt, 2)
  const card = readFileSync(
    path.join(root, prepared.state.current_invocation?.markdown_path ?? ''),
    'utf8',
  )

  assert.match(card, /"revises"/u)
  assert.ok(card.includes(firstInvocationId))

  const template = makeOutput(root, invocation, implementStage)
  const patch = {
    revises: firstInvocationId,
    patch: {
      invocation_id: invocation.invocation_id,
      result: 'success',
      $operator: template.$operator,
      artifacts: template.artifacts,
      criteria: template.criteria,
      invocation_attestation: template.invocation_attestation,
      data: {
        implementation: {
          remediation: [
            {
              cause: 'Acceptance claim lacked evidence',
              action: 'Mapped every criterion to fixture evidence',
              evidence: ['request.md'],
            },
          ],
        },
      },
    },
  }

  writeJson(path.join(root, invocation.output.path), patch)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.current_stage, 'verify')

  const historyItem = submitted.state.stage_history.find(
    (item) => item.invocation_id === invocation.invocation_id,
  )

  assert.equal(historyItem?.revised_from, firstInvocationId)

  const merged = JSON.parse(
    readFileSync(path.join(root, invocation.output.path), 'utf8'),
  ) as Record<string, Record<string, unknown>>

  assert.equal(
    merged.invocation_id as unknown as string,
    invocation.invocation_id,
  )
  assert.equal(merged.result as unknown as string, 'success')
  assert.deepEqual(
    (merged.data.implementation as Record<string, unknown>).changed_files,
    (firstOutput.data.implementation as Record<string, unknown>).changed_files,
  )
  assert.equal(
    (
      (merged.data.implementation as Record<string, unknown>)
        .remediation as unknown[]
    ).length,
    1,
  )

  const replay = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(replay.idempotent, true)
})

test('a claims omission rejects the submission before any shell gate executes', () => {
  const markerDir = createTestTempDirectory('pancreator-gate-marker-')
  const marker = path.join(markerDir, 'gate-executed')
  const writeMarker = (profile: string): string =>
    `node -e "require('node:fs').writeFileSync(${JSON.stringify(marker)}, '${profile}')"`
  const { root, runId, invocation, workflow } = checkpoint(
    'delivery@implement-prepared',
    checksVariant('checks=marker-on-execution', {
      static: { probes: [], commands: [writeMarker('static')] },
      fast: { probes: [], commands: [writeMarker('fast')] },
    }),
  )

  assert.ok(invocation)
  // Baselines ran the profiles before implementation; only a gate at submit
  // may write the marker from here on.
  rmSync(marker, { force: true })

  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeFileSync(path.join(root, 'src/extra.ts'), 'export const extra = 1\n')

  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, 'implement'),
  )
  const implementation = output.data.implementation as Record<string, unknown>

  implementation.changed_files = ['src/base.ts']
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])
  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const shellGates = submitted.record.evaluation.deterministic.filter(
    (result) => result.type === 'shell',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.ok(shellGates.length > 0)

  for (const gate of shellGates) {
    assert.equal(gate.skipped, true, `${gate.id} was not skipped`)
    assert.equal(gate.evidence_path, undefined)
    assert.match(
      gate.explanation ?? '',
      /harness validator IMPLEMENTATION-CLAIMS-VALIDATE-001 rejected the output/u,
    )
  }

  assert.equal(existsSync(marker), false, 'a shell gate executed')
  assert.ok(
    submitted.record.evaluation.governance_artifact_warnings?.some((warning) =>
      /IMPLEMENTATION-CLAIMS-VALIDATE-001 failed: .*src\/extra\.ts/u.test(
        warning,
      ),
    ),
  )
  rmSync(markerDir, { recursive: true, force: true })
})
