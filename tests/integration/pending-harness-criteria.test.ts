import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation } from '../../src/lib/engine.js'
import { validateOutputForSubmission } from '../../src/lib/engine/output-validation.js'
import type { StageDefinition } from '../../src/lib/types/workflow.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import {
  attachTargetInstructionEvidence,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { checkpoint, checksVariant, PASS } from './delivery-helpers.js'

const SHELL_IDS = [
  'implement.lint',
  'implement.unit_tests',
  'configuration.valid',
  'implement.impacted_integration',
]

function variant(mode: 'pass' | 'fail' | 'disabled' | 'entry' = 'pass') {
  const configured = checksVariant(
    `pending-harness-${mode}`,
    {
      static: { probes: [], commands: [PASS] },
      fast: { probes: [], commands: [PASS] },
      full: { probes: [], commands: [PASS, PASS] },
      configuration: { probes: [], commands: [PASS] },
      'impacted-integration': { probes: [], commands: [PASS] },
    },
    { gatesPath: 'runtime/pending-gates.json' },
  )
  const configure = configured.fixture

  configured.fixture = (root) => {
    configure?.(root)
    writeJson(
      path.join(root, 'runtime/pending-gates.json'),
      Object.fromEntries(
        SHELL_IDS.map((id) => [
          id,
          mode === 'disabled' && id === 'implement.unit_tests'
            ? false
            : `node -e "require('node:fs').appendFileSync('runtime/pending-counts', '${id}\\n'); process.exit(${mode === 'fail' && id === 'implement.lint' ? 1 : 0})"`,
        ]),
      ),
    )

    if (mode === 'entry') {
      const stagePath = path.join(
        root,
        'library/workflows/delivery/stages/implement.json',
      )
      const stage: StageDefinition = JSON.parse(readFileSync(stagePath, 'utf8'))

      stage.entry_gate = {
        criterion: 'implement.lint',
        failure: 'remediate',
        max_loops: 1,
      }
      writeJson(stagePath, stage)
    }
  }

  return configured
}

function counts(root: string): string[] {
  const marker = path.join(root, 'runtime/pending-counts')

  return existsSync(marker)
    ? readFileSync(marker, 'utf8').trim().split('\n')
    : []
}

function pendingOutput(
  prepared: ReturnType<typeof checkpoint>,
  result: 'success' | 'failure' | 'blocked' = 'success',
) {
  const { root, invocation, workflow } = prepared

  assert.ok(invocation)
  const stage = stageBySlug(workflow, 'implement')
  const output = makeOutput(root, invocation, stage, result)

  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])

  if (result === 'blocked') {
    output.data = {
      blocked: {
        missing_precondition: 'Fixture external prerequisite is unavailable.',
        supplying_command: 'node -e "process.exit(0)"',
        evidence: ['Fixture prerequisite remains unavailable.'],
      },
      acceptance_results: [],
    }
  }

  for (const claim of output.criteria) {
    if (SHELL_IDS.includes(claim.id)) {
      claim.result = 'pending_harness'
      claim.explanation =
        'Selected checks passed; the declared profile awaits the harness.'
    }
  }

  return output
}

for (const mode of ['pass', 'disabled', 'entry'] as const) {
  test(`pending harness shells settle once with ${mode} gates and preserve claims`, () => {
    const prepared = checkpoint('delivery@implement-prepared', variant(mode))
    const { root, runId, invocation } = prepared

    assert.ok(invocation)
    const output = pendingOutput(prepared)
    const outputPath = path.join(root, invocation.output.path)

    writeJson(outputPath, output)
    const preflight = validateOutputForSubmission(
      root,
      runId,
      invocation,
      output,
      {
        submittedPath: invocation.output.path,
      },
    )

    assert.equal(
      preflight.passed,
      true,
      preflight.checks
        .filter((check) => !check.passed)
        .map((check) => check.message)
        .join('\n'),
    )
    assert.deepEqual(counts(root), mode === 'entry' ? ['implement.lint'] : [])
    writeCanonicalDelegation(root, invocation)
    const submitted = submitAsSupervisor(root, runId, outputPath)

    assert.equal(
      submitted.record.outcome,
      'success',
      JSON.stringify(submitted.record.evaluation),
    )
    assert.equal(submitted.state.current_stage, 'verify')
    assert.equal(submitted.record.invocation_id, invocation.invocation_id)
    const expected = SHELL_IDS.filter(
      (id) => mode !== 'disabled' || id !== 'implement.unit_tests',
    )

    assert.deepEqual(counts(root), expected)
    assert.deepEqual(submitted.record.evaluation.self, output.criteria)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), output)

    for (const id of SHELL_IDS) {
      const terminal = submitted.record.evaluation.deterministic.find(
        (criterion) => criterion.id === id,
      )

      assert.ok(terminal)
      assert.equal(terminal.type, 'shell')
      assert.notEqual(terminal.skipped, true)
      if (mode === 'disabled' && id === 'implement.unit_tests') {
        assert.equal(terminal.disabled, true)
      } else {
        assert.equal(terminal.passed, true)
        assert.ok(terminal.evidence_path)
        assert.ok(existsSync(path.join(root, terminal.evidence_path)))
      }
      if (mode === 'entry' && id === 'implement.lint') {
        assert.equal(terminal.entry_gate, true)
      }
    }

    const replay = submitAsSupervisor(root, runId, outputPath)

    assert.equal(replay.idempotent, true)
    assert.equal(replay.record.outcome, 'success')
    assert.equal(
      replay.state.stage_history.length,
      submitted.state.stage_history.length,
    )
    assert.deepEqual(counts(root), expected)
  })
}

test('a failed required gate settles pending success as failure without rewriting the claim', () => {
  const prepared = checkpoint('delivery@implement-prepared', variant('fail'))
  const { root, runId, invocation } = prepared

  assert.ok(invocation)
  const output = pendingOutput(prepared)

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const failed = submitted.record.evaluation.deterministic.find(
    (criterion) => criterion.id === 'implement.lint',
  )

  assert.equal(submitted.record.outcome, 'failure')
  assert.equal(submitted.state.current_stage, 'implement')
  assert.deepEqual(counts(root), SHELL_IDS)
  assert.equal(failed?.passed, false)
  assert.ok(failed?.evidence_path)
  assert.deepEqual(submitted.record.evaluation.self, output.criteria)
})

test('merge patch pending criteria settle the same retry without another worker', () => {
  const prior = checkpoint('delivery@implement-failed-once', variant())
  const previous = prior.state.stage_history.at(-1)

  assert.ok(previous)
  const prepared = prepareInvocation(prior.root, prior.runId)
  const invocation = prepared.invocation

  assert.ok(invocation)
  const output = pendingOutput({ ...prior, ...prepared, invocation })

  writeJson(path.join(prior.root, invocation.output.path), {
    revises: previous.invocation_id,
    patch: output,
  })
  writeCanonicalDelegation(prior.root, invocation)
  const submitted = submitAsSupervisor(
    prior.root,
    prior.runId,
    invocation.output.path,
  )

  assert.equal(
    submitted.record.outcome,
    'success',
    JSON.stringify(submitted.record.evaluation),
  )
  assert.equal(submitted.state.stage_history.at(-1)?.attempt, 2)
  assert.deepEqual(counts(prior.root), SHELL_IDS)
  assert.deepEqual(submitted.record.evaluation.self, output.criteria)
})

for (const invalid of [
  'judgment',
  'unknown',
  'missing',
  'unevaluated',
  'skipped',
] as const) {
  test(`${invalid} criteria fail preflight and submission before any shell gate`, () => {
    const prepared = checkpoint('delivery@implement-prepared', variant())
    const { root, runId, invocation } = prepared

    assert.ok(invocation)
    const output = pendingOutput(prepared)
    const claim = output.criteria.find(
      (criterion) => criterion.id === 'implement.lint',
    )

    assert.ok(claim)
    switch (invalid) {
      case 'judgment':
        output.criteria[0]!.result = 'pending_harness'
        break
      case 'unknown':
        output.criteria.push({ ...claim, id: 'unknown.pending' })
        break
      case 'missing':
        output.criteria = output.criteria.filter(
          (criterion) => criterion !== claim,
        )
        break
      case 'unevaluated':
        claim.result = 'unevaluated'
        break
      case 'skipped':
        claim.result = 'skipped'
        break
    }

    writeJson(path.join(root, invocation.output.path), output)
    assert.equal(
      validateOutputForSubmission(root, runId, invocation, output, {
        submittedPath: invocation.output.path,
      }).passed,
      false,
    )
    writeCanonicalDelegation(root, invocation)
    const submitted = submitAsSupervisor(root, runId, invocation.output.path)

    assert.equal(submitted.record.outcome, 'failure')
    assert.deepEqual(counts(root), [])
    assert.ok(submitted.record.evaluation.validation_errors.length > 0)
    assert.ok(
      submitted.record.evaluation.deterministic.every(
        (criterion) => criterion.type !== 'shell' || criterion.skipped,
      ),
    )
  })
}

for (const result of ['failure', 'blocked'] as const) {
  test(`declared ${result} preserves its outcome and skips pending shells`, () => {
    const prepared = checkpoint('delivery@implement-prepared', variant())
    const { root, runId, invocation } = prepared

    assert.ok(invocation)
    const output = pendingOutput(prepared, result)

    writeJson(path.join(root, invocation.output.path), output)
    writeCanonicalDelegation(root, invocation)
    const submitted = submitAsSupervisor(root, runId, invocation.output.path)

    assert.equal(
      submitted.record.outcome,
      result,
      JSON.stringify(submitted.record.evaluation.validation_errors),
    )
    assert.deepEqual(counts(root), [])
    assert.deepEqual(submitted.record.evaluation.self, output.criteria)
    assert.ok(
      submitted.record.evaluation.deterministic.every(
        (criterion) => criterion.type !== 'shell' || criterion.skipped,
      ),
    )
  })
}
