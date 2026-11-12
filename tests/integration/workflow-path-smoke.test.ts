import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { workflowSupportsDesignComposition } from '../../src/lib/design-composition.js'
import { assessStage, decideRun, getRunState } from '../../src/lib/engine.js'
import { listWorkflowSlugs, loadWorkflow } from '../../src/lib/workflow.js'
import type { RunState, StageOutput } from '../../src/lib/types.js'
import {
  attachTargetInstructionEvidence,
  createFixture,
  writeJson,
} from '../helpers.js'
import { createRun } from '../run-helpers.js'
import {
  failingVerify,
  runWorkflow,
  submitCurrentStage,
} from './delivery-helpers.js'

const TERMINAL = new Set(['succeeded', 'failed', 'paused', 'aborted'])
const PASS = 'node -e "process.exit(0)"'
const MAX_SMOKE_STEPS = 16

const SUCCESS_PATHS: Record<string, string[]> = {
  planning: ['plan'],
  'planning with design': ['design', 'plan'],
  delivery: ['implement', 'verify', 'ship'],
  'delivery with design': ['implement', 'verify', 'ship'],
  'delivery-chunk': ['implement', 'verify'],
  'delivery-chunk with design': ['implement', 'verify'],
  'delivery-candidate': ['plan', 'implement', 'verify'],
  metacritic: ['consolidate', 'verify', 'ship'],
  design: ['intake', 'design', 'review', 'test', 'handoff'],
  'one-shot': ['implement', 'ship'],
  prototype: ['intake', 'approach', 'build', 'evaluate'],
}

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function stageSlug(state: RunState): string {
  assert.ok(state.current_stage)

  return state.current_stage
}

function instantChecks(root: string): void {
  const profile = (name: string) => ({
    probes: [],
    commands: [`node -e "process.exit(0)" /* ${name} */`],
  })

  writeJson(`${root}/runtime/repository-checks.json`, {
    schema_version: 1,
    profiles: {
      static: profile('static'),
      fast: profile('fast'),
      configuration: profile('configuration'),
      'impacted-integration': profile('impacted-integration'),
      full: profile('full'),
    },
  })
  writeJson(`${root}/gates.json`, {
    'verify.fast_wall_ceiling': PASS,
  })
}

function fillStage(
  root: string,
  workflow: string,
  stage: string,
  output: StageOutput,
): void {
  attachTargetInstructionEvidence(root, output, ['AGENTS.md'])

  if (workflow === 'one-shot' && stage === 'implement') {
    output.data.informal_plan = 'Change one sentinel file and cover it.'
    output.data.test_scenarios = [
      {
        id: 'TS-01',
        steps: 'Run the fast check',
        expected: 'The sentinel is present',
      },
    ]
    output.data.cycles_used = 1
  }

  if (stage === 'review' && workflow.startsWith('design')) {
    const review = output.data.review as Record<string, unknown>

    review.heuristic_results = [
      { id: 'H-01', result: 'pass', evidence: ['fixture'] },
    ]
  }
}

function settle(root: string, runId: string, state: RunState): RunState {
  if (state.status === 'awaiting_operator') {
    return decideRun(root, runId, 'approve', 'fixture approval')
  }

  if (
    state.status === 'awaiting_supervisor' &&
    state.pending_action.type === 'supervisor_assessment'
  ) {
    const invocationId = state.current_invocation?.id

    assert.ok(invocationId)
    writeJson(`${root}/${state.pending_action.output_path}`, {
      schema_version: 1,
      assessment_id: randomUUID(),
      invocation_id: invocationId,
      verdict: 'pass',
      summary: 'Fixture assessment.',
      criteria: [],
    })

    return assessStage(root, runId, state.pending_action.output_path).state
  }

  return state
}

function walkSuccess(
  root: string,
  runId: string,
  workflow: string,
): { status: string; visited: string[] } {
  const visited: string[] = []
  let state = getRunState(root, runId)

  for (
    let step = 0;
    step < MAX_SMOKE_STEPS && !TERMINAL.has(state.status);
    step += 1
  ) {
    const stage = stageSlug(state)
    const submitted = submitCurrentStage(root, runId, 'success', [], (output) =>
      fillStage(root, workflow, stage, output),
    )

    assert.equal(
      submitted.record.outcome,
      'success',
      `${workflow}/${stage}: ${JSON.stringify(submitted.record.evaluation)}`,
    )
    visited.push(stage)
    state = settle(root, runId, submitted.state)
  }

  return { status: state.status, visited }
}

function start(root: string, slug: string, design: boolean): { runId: string } {
  instantChecks(root)

  const state = createRun(root, {
    workflowSlug: slug,
    requestPath: 'request.md',
    title: design ? `${slug} with design` : slug,
    gatesPath: 'gates.json',
    ...(design ? { design: true } : {}),
  })

  return { runId: state.run_id }
}

test('every installed workflow walks its success path', () => {
  const catalog = createFixture()
  const failures: string[] = []
  const discovered = new Set<string>()

  for (const slug of listWorkflowSlugs(catalog)) {
    const workflow = loadWorkflow(catalog, slug)
    const variants = workflowSupportsDesignComposition(workflow)
      ? [
          { label: slug, design: false },
          { label: `${slug} with design`, design: true },
        ]
      : [{ label: slug, design: false }]

    for (const variant of variants) {
      const expected = SUCCESS_PATHS[variant.label]
      discovered.add(variant.label)

      try {
        assert.ok(expected, `no expected path for ${variant.label}`)
        const root = createFixture()
        const { runId } = start(root, slug, variant.design)

        if (variant.design) {
          const snapshot = runWorkflow(root, getRunState(root, runId))

          for (const [stageSlug, override] of Object.entries(
            workflow.design_composition?.stage_overrides ?? {},
          )) {
            if (!override.evidence_workers) {
              continue
            }

            const stage = snapshot.stages.find(
              (candidate) => candidate.slug === stageSlug,
            )

            assert.ok(stage, `${variant.label} missing ${stageSlug}`)
            const roles = (stage.evidence_workers ?? []).map(
              (worker) => worker.role,
            )

            for (const worker of override.evidence_workers) {
              assert.ok(
                roles.includes(worker.role),
                `${variant.label} ${stageSlug} missing ${worker.role}`,
              )
            }
          }
        }

        const walked = walkSuccess(root, runId, variant.label)

        assert.equal(walked.status, 'succeeded')
        assert.deepEqual(walked.visited, expected)
      } catch (error) {
        failures.push(`${variant.label}: ${failureText(error)}`)
      }
    }
  }

  for (const label of Object.keys(SUCCESS_PATHS)) {
    if (!discovered.has(label)) {
      failures.push(`${label}: workflow variant missing`)
    }
  }

  assert.deepEqual(failures, [])
})

test('failure routes reach the declared recovery stage', () => {
  const cases: Array<{
    label: string
    slug: string
    design?: boolean
    until: string
    result?: 'failure' | 'blocked'
    failedCriteria?: string[]
    mutate?: (output: StageOutput) => void
    expectStage: string
    expectStatus: string
  }> = [
    {
      label: 'one-shot implement failure retries implement',
      slug: 'one-shot',
      until: 'implement',
      result: 'failure',
      failedCriteria: ['implement.acceptance_claimed'],
      expectStage: 'implement',
      expectStatus: 'running',
    },
    {
      label: 'one-shot implement blocked pauses',
      slug: 'one-shot',
      until: 'implement',
      result: 'blocked',
      mutate: (output) => {
        output.criteria = output.criteria.map((criterion) => ({
          ...criterion,
          result: 'skipped',
          explanation: 'The change exceeds the one-shot bound.',
        }))
        delete output.data.implementation
        output.data.acceptance_results = []
        output.data.blocked = {
          missing_precondition: 'The target file is absent.',
          supplying_command: 'Create the target file.',
          evidence: ['fixture'],
        }
        output.data.escalation = {
          reason: 'The change exceeds the one-shot bound.',
          route: 'standard',
          evidence: ['fixture'],
        }
      },
      expectStage: 'implement',
      expectStatus: 'paused',
    },
    {
      label: 'delivery-chunk verify failure routes to remediate',
      slug: 'delivery-chunk',
      until: 'verify',
      result: 'failure',
      failedCriteria: ['verify.acceptance_met'],
      mutate: (output) => {
        output.data.verify = failingVerify('VF-CHUNK-1')
      },
      expectStage: 'remediate',
      expectStatus: 'running',
    },
    {
      label: 'delivery-candidate verify failure routes to remediate',
      slug: 'delivery-candidate',
      until: 'verify',
      result: 'failure',
      failedCriteria: ['verify.acceptance_met'],
      mutate: (output) => {
        output.data.verify = failingVerify('VF-CAND-1')
      },
      expectStage: 'remediate',
      expectStatus: 'running',
    },
    {
      label: 'metacritic verify failure routes to consolidate',
      slug: 'metacritic',
      until: 'verify',
      result: 'failure',
      failedCriteria: ['verify.acceptance_met'],
      mutate: (output) => {
        output.data.verify = failingVerify('VF-META-1')
      },
      expectStage: 'consolidate',
      expectStatus: 'running',
    },
    {
      label: 'design review failure returns to design',
      slug: 'design',
      until: 'review',
      result: 'failure',
      failedCriteria: ['review.heuristics_scored'],
      mutate: (output) => {
        const review = output.data.review as Record<string, unknown>

        review.verdict = 'fail'
        review.heuristic_results = [
          { id: 'H-01', result: 'fail', evidence: ['fixture'] },
        ]
      },
      expectStage: 'design',
      expectStatus: 'running',
    },
  ]
  const failures: string[] = []

  for (const item of cases) {
    try {
      const root = createFixture()
      const { runId } = start(root, item.slug, item.design === true)
      let state = getRunState(root, runId)

      for (
        let step = 0;
        step < MAX_SMOKE_STEPS &&
        state.current_stage !== item.until &&
        !TERMINAL.has(state.status);
        step += 1
      ) {
        const stage = stageSlug(state)
        const submitted = submitCurrentStage(
          root,
          runId,
          'success',
          [],
          (output) => fillStage(root, item.slug, stage, output),
        )

        assert.equal(
          submitted.record.outcome,
          'success',
          `${item.label}/${stage}: ${JSON.stringify(submitted.record.evaluation)}`,
        )
        state = settle(root, runId, submitted.state)
      }

      assert.equal(state.current_stage, item.until, item.label)
      const submitted = submitCurrentStage(
        root,
        runId,
        item.result ?? 'failure',
        item.failedCriteria ?? [],
        (output) => {
          fillStage(root, item.slug, item.until, output)
          item.mutate?.(output)
        },
      )

      assert.equal(
        submitted.record.outcome,
        item.result ?? 'failure',
        `${item.label}: ${JSON.stringify(submitted.record.evaluation)}`,
      )
      assert.equal(submitted.state.current_stage, item.expectStage, item.label)
      assert.equal(submitted.state.status, item.expectStatus, item.label)
    } catch (error) {
      failures.push(`${item.label}: ${failureText(error)}`)
    }
  }

  assert.deepEqual(failures, [])
})
