import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  materializeOutputSubmission,
  prepareInvocation,
  validateOutputForSubmission,
} from '../../src/lib/engine.js'
import {
  claudeCodeToolPolicy,
  copilotToolPolicy,
  openAiToolPolicy,
} from '../../src/lib/engine/executors.js'
import { buildContextReference } from '../../src/lib/context/references.js'
import { executeOpenAiTool } from '../../src/lib/executors/openai-tools.js'
import { isRecord } from '../../src/lib/io.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { isUntouchedScaffold } from '../../src/lib/requirements/scaffold.js'
import { loadState } from '../../src/lib/state.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { makeOutput, writeCanonicalDelegation, writeJson } from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('planning preparation supplies unfinished file-only artifacts and preserves authored output', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'planning@plan-prepared',
  )

  assert.ok(invocation)
  const outputPath = path.join(root, invocation.output.path)
  const scaffold: unknown = JSON.parse(readFileSync(outputPath, 'utf8'))

  assert.ok(isUntouchedScaffold(scaffold))
  assert.ok(
    existsSync(
      path.join(root, `runtime/logs/workflows/${runId}/operator/specs`),
    ),
  )
  assert.equal(invocation.output.scaffold_command, undefined)
  assert.equal(
    invocation.requirements?.automation_requirements.find(
      (item) => item.registry_id === 'STAGE-SCAFFOLD-001',
    )?.executor,
    'harness',
  )
  const stage = stageBySlug(workflow, 'plan')

  assert.ok(
    !claudeCodeToolPolicy(root, root, stage).allowedTools.includes('Bash'),
  )
  assert.ok(
    !openAiToolPolicy(root, root, stage, {
      maxResultBytes: 1000,
      shellTimeoutMs: 1000,
    }).allowedTools.includes('run_shell'),
  )
  assert.ok(
    !copilotToolPolicy(root, root, stage, 'planner').availableTools.includes(
      'bash',
    ),
  )
  assert.ok(isRecord(scaffold))
  const authored = JSON.stringify({
    ...scaffold,
    summary: 'Authored claims',
  })

  writeFileSync(outputPath, authored)
  prepareInvocation(root, runId)
  assert.equal(readFileSync(outputPath, 'utf8'), authored)

  for (const context of [
    {
      workflow: 'planning',
      stage: 'plan',
      persona: 'coder',
      invocation_kind: 'workflow' as const,
      registry: 'STAGE-SCAFFOLD-001',
    },
    {
      workflow: 'delivery',
      stage: 'implement',
      persona: 'coder',
      invocation_kind: 'workflow' as const,
      registry: 'STAGE-SCAFFOLD-001',
    },
    {
      workflow: 'delivery',
      stage: 'implement',
      persona: 'orchestrator',
      invocation_kind: 'assessment' as const,
      registry: 'ASSESSMENT-SCAFFOLD-001',
    },
    {
      workflow: '',
      stage: '',
      persona: 'coder',
      invocation_kind: 'spotfix' as const,
      registry: 'SPOTFIX-ESCALATION-SCAFFOLD-001',
    },
  ]) {
    const resolved = resolveRequirements(root, context)

    assert.equal(
      resolved.automation_requirements.find(
        (item) => item.registry_id === context.registry,
      )?.executor,
      'agent',
    )
  }
})

for (const result of ['failure', 'blocked'] as const) {
  test(`planning submission records ${result} with absent or unfinished specifications`, () => {
    for (const scenario of ['absent', 'empty', 'missing-files', 'complete']) {
      const { root, runId, invocation, workflow } = checkpoint(
        'planning@plan-prepared',
      )

      assert.ok(invocation)
      const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))

      output.result = result
      output.summary = 'Planning could not finish; retain the recovery route.'

      if (scenario === 'absent') {
        delete output.data.cohort_plan
      } else if (scenario === 'empty') {
        output.data.cohort_plan = {}
      } else if (scenario === 'missing-files') {
        output.data.cohort_plan = {
          parent_spec_path: `runtime/logs/workflows/${runId}/operator/specs/absent.md`,
          chunks: [{ child_spec_path: 'unfinished.md' }],
        }
      }

      const claims = structuredClone(output)

      writeJson(path.join(root, invocation.output.path), output)
      writeCanonicalDelegation(root, invocation)
      const before = loadState(root, runId)

      validateOutputForSubmission(root, runId, invocation, output)
      assert.deepEqual(loadState(root, runId), before)
      assert.deepEqual(output, claims)
      const submitted = submitAsSupervisor(root, runId, invocation.output.path)
      const outcome = scenario === 'complete' ? result : 'failure'

      assert.equal(submitted.record.outcome, outcome, scenario)
      assert.equal(submitted.state.stage_history.at(-1)?.outcome, outcome)
      assert.equal(submitted.state.status, 'awaiting_operator')
      assert.equal(submitted.state.pending_action.type, 'operator_approval')
      if (scenario !== 'complete') {
        assert.ok(
          submitted.record.evaluation.validation_errors.length > 0 ||
            (submitted.record.evaluation.governance_artifact_warnings?.length ??
              0) > 0,
          'Incomplete plans retain strict validation diagnostics.',
        )
      }
      assert.deepEqual(
        JSON.parse(
          readFileSync(path.join(root, invocation.output.path), 'utf8'),
        ),
        claims,
      )
    }
  })
}

test('planning validation and submission share finalized full and revised outputs', () => {
  const { root, runId, invocation, workflow } = checkpoint(
    'planning@plan-prepared',
  )

  assert.ok(invocation)
  const output = makeOutput(root, invocation, stageBySlug(workflow, 'plan'))
  const plan = output.data.cohort_plan

  assert.ok(isRecord(plan))
  assert.ok(typeof plan.parent_spec_path === 'string')
  const parentSpecPath = plan.parent_spec_path
  assert.ok(Array.isArray(plan.chunks))
  assert.ok(isRecord(plan.chunks[0]))
  assert.ok(typeof plan.chunks[0].child_spec_path === 'string')
  const childPath = path.join(root, plan.chunks[0].child_spec_path)
  const original = readFileSync(childPath, 'utf8')
  const policy = openAiToolPolicy(root, root, stageBySlug(workflow, 'plan'), {
    maxResultBytes: 10000,
    shellTimeoutMs: 1000,
  })
  const workerWrite = (relative: string, content: string) => {
    const result = executeOpenAiTool(
      'write_file',
      JSON.stringify({ path: relative, content }),
      policy,
    )

    assert.equal(result.ok, true, result.output)
  }
  const specs = `runtime/logs/workflows/${runId}/operator/specs`
  const canonicalDigest = () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'dist/src/cli.js'),
        'context',
        'digest',
        parentSpecPath,
      ],
      { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 },
    )

    assert.equal(result.status, 0, result.stderr)

    return result.stdout.trim()
  }

  plan.chunks = ['c1', 'c2', 'c3'].map((id) => ({
    id,
    title: `Outcome ${id}`,
    cohort_index: 1,
    child_spec_path: `${specs}/${id}.md`,
    depends_on: [],
  }))
  plan.cohorts = [{ index: 1, chunks: ['c1', 'c2', 'c3'] }]
  plan.shared_items = ['US-01', 'C-1', 'OOS-1']
  workerWrite(
    plan.parent_spec_path,
    '\n # Parent specification\n\nThe complete record, with Unicode \u03bb.\n \n',
  )

  for (const id of ['c1', 'c2', 'c3']) {
    workerWrite(
      `${specs}/${id}.md`,
      original.replace(/sha256:[0-9a-f]{64}/u, 'harness-pending'),
    )
  }

  workerWrite(invocation.output.path, JSON.stringify(output))
  writeCanonicalDelegation(root, invocation)
  const before = loadState(root, runId)
  const claims = structuredClone(output)
  const mirror = validateOutputForSubmission(root, runId, invocation, output)

  assert.equal(mirror.passed, true, JSON.stringify(mirror.checks))
  for (const registry of [
    'COHORT-PLAN-VALIDATE-001',
    'CHILD-SPEC-VALIDATE-001',
  ]) {
    assert.ok(
      mirror.checks.some(
        (check) => check.id === `validator.${registry}` && check.passed,
      ),
    )
  }
  assert.deepEqual(loadState(root, runId), before)
  assert.ok(
    readFileSync(childPath, 'utf8').includes(
      buildContextReference(root, plan.parent_spec_path).content_sha256,
    ),
  )
  for (const id of ['c1', 'c2', 'c3']) {
    assert.ok(
      readFileSync(path.join(root, `${specs}/${id}.md`), 'utf8').includes(
        buildContextReference(root, plan.parent_spec_path).content_sha256,
      ),
    )
  }

  assert.deepEqual(output, claims)
  assert.equal(
    buildContextReference(root, plan.parent_spec_path).content_sha256,
    canonicalDigest(),
  )

  const revisedState = structuredClone(before)
  const priorId = 'previous-plan'
  const priorPath = `runtime/logs/workflows/${runId}/agent/outputs/previous-plan.json`

  writeJson(path.join(root, priorPath), { ...output, invocation_id: priorId })
  revisedState.stage_history.push({
    stage: 'plan',
    attempt: 1,
    outcome: 'failure',
    invocation_id: priorId,
    output_path: priorPath,
    submitted_at: new Date().toISOString(),
    workspace_fingerprint: before.current_invocation?.id ?? 'fixture',
    validation_errors: [],
    deterministic: [],
  })
  const revision = {
    revises: priorId,
    patch: {
      invocation_id: invocation.invocation_id,
      summary: 'Revised authored summary',
    },
  }

  workerWrite(parentSpecPath, '\n# Revised parent\n\nUnicode: \u03bb\n\n')
  const materialized = materializeOutputSubmission(
    root,
    revisedState,
    revision,
    invocation.invocation_id,
  )

  assert.ok(isRecord(materialized.value))
  assert.equal(materialized.value.summary, 'Revised authored summary')
  assert.deepEqual(materialized.value.criteria, output.criteria)
  assert.equal(
    buildContextReference(root, plan.parent_spec_path).content_sha256,
    canonicalDigest(),
  )
  assert.ok(
    readFileSync(childPath, 'utf8').includes(
      buildContextReference(root, plan.parent_spec_path).content_sha256,
    ),
  )
  const finalized = readFileSync(childPath, 'utf8')

  writeFileSync(
    childPath,
    finalized.replace(/sha256:[0-9a-f]{64}/u, 'harness-pending'),
  )
  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(submitted.record.outcome, 'success')
  assert.equal(submitted.state.status, 'awaiting_operator')
  assert.equal(readFileSync(childPath, 'utf8'), finalized)
  assert.deepEqual(output.criteria, materialized.value.criteria)
})
