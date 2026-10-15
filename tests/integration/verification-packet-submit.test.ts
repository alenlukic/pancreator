import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { verificationEvidencePacketPath } from '../../src/lib/verification-evidence.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { checkpoint, submitStageOutput } from './delivery-helpers.js'

interface Packet {
  status: string
  incoming: unknown[]
  verifications: { verdict: string }[]
  checks: { id: string; passed: boolean; skipped?: boolean }[]
  structural_repairs: unknown[]
}

test('the real verifier receives one incoming packet, repairs representation, and extends it with the final fast proof', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const location = verificationEvidencePacketPath(root, runId)
  const before = JSON.parse(readFileSync(location.absolute, 'utf8')) as Packet
  assert.equal(before.status, 'pending')
  assert.ok(before.incoming.length > 0)
  const result = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'success',
    [],
    (output) => {
      const verify = output.data.verify as Record<string, unknown>
      for (const citation of (verify.gate_evidence_citations as Record<
        string,
        unknown
      >[]) ?? []) {
        citation.workspace_fingerprint = citation.fingerprint
        citation.path = citation.evidence_path
        delete citation.fingerprint
        delete citation.evidence_path
      }
    },
  )
  assert.equal(
    result.record.outcome,
    'success',
    JSON.stringify(result.record.evaluation),
  )
  const after = JSON.parse(readFileSync(location.absolute, 'utf8')) as Packet
  assert.equal(after.status, 'passed')
  assert.equal(after.verifications.at(-1)?.verdict, 'pass')
  assert.ok(
    after.checks.some(
      (check) =>
        check.id === 'verify.final_fast' && check.passed && !check.skipped,
    ),
  )
  assert.ok(after.structural_repairs.length > 0)
  assert.ok(after.incoming.length > 0)
})

test('a real failed verifier signal stays failed and skips the final fast gate without manufacturing a pass', () => {
  const { root, runId, workflow } = checkpoint('delivery@verify-prepared')
  const result = submitStageOutput(
    root,
    runId,
    stageBySlug(workflow, 'verify'),
    'failure',
    ['verify.acceptance_met'],
    (output) => {
      const verify = output.data.verify as Record<string, unknown>
      verify.verdict = 'fail_remedial'
      verify.remediation_guidance =
        'Reproduce the failed behavior and repair the implementation.'
    },
  )
  assert.equal(result.record.outcome, 'failure')
  const packet = JSON.parse(
    readFileSync(verificationEvidencePacketPath(root, runId).absolute, 'utf8'),
  ) as Packet
  assert.equal(packet.status, 'failed')
  assert.equal(packet.verifications.at(-1)?.verdict, 'fail_remedial')
  assert.ok(
    packet.checks.some(
      (check) => check.id === 'verify.final_fast' && check.skipped,
    ),
  )
})
