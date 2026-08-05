import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  prepareInvocation,
  setRunStage,
  submitOutput,
} from '../../src/lib/engine.js'
import { PanError } from '../../src/lib/errors.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  validateDelegationMarkdown,
  validateStageOutput,
} from '../../src/lib/validation.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { validatePlanTrace } from '../../src/lib/validators/stage-validators.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

/**
 * Regressions for the mechanical friction found in the detached rowspace runs.
 * Each test pins behavior whose absence forced an agent to stop, diagnose, and
 * work around the harness mid-run.
 */

/**
 * Change the persona mapping a run actually resolves.
 *
 * A named entry under `configs` overrides `defaults`, so editing `defaults`
 * alone changes nothing when the active configuration pins the same persona.
 * Clearing each touched persona from every named configuration keeps these
 * regressions independent of whichever `active_config` the checked-in
 * configuration declares.
 */
function editPersonaMappings(
  root: string,
  edit: (defaults: Record<string, string>) => void,
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs?: Record<string, { personas?: Record<string, string> }>
  }
  const before = { ...config.defaults }

  edit(config.defaults)

  const touched = Object.keys(config.defaults).filter(
    (persona) => config.defaults[persona] !== before[persona],
  )

  for (const named of Object.values(config.configs ?? {})) {
    for (const persona of touched) {
      delete named.personas?.[persona]
    }
  }

  writeJson(configPath, config)
}

test('an unrecognized criterion verdict is reported, not silently failed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Unknown verdict run',
  })
  const stage = stageBySlug(workflow, 'intake')
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)

  const output = makeOutput(root, invocation, stage) as unknown as Record<
    string,
    unknown
  >
  const criteria = output.criteria as Array<Record<string, unknown>>

  // A model writing "partial" previously coerced to fail with no diagnostic,
  // so the retry could not tell what to fix and repeated the same mistake.
  criteria[0].result = 'partial'

  const validation = validateStageOutput(root, stage, invocation, output)

  assert.ok(
    validation.errors.some(
      (message) =>
        message.includes(String(criteria[0].id)) &&
        message.includes('pass, fail, or not_applicable') &&
        message.includes('"partial"'),
    ),
    `expected an explicit verdict error, got: ${validation.errors.join(' | ')}`,
  )
})

test('a retry card inlines the recorded reason the prior attempt failed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Retry disclosure run',
  })
  const runId = state.run_id
  const stage = stageBySlug(workflow, 'implement')

  setRunStage(
    root,
    runId,
    'implement',
    'Seed implementation for retry testing.',
  )

  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)

  const output = makeOutput(root, first, stage, 'failure')

  output.result = 'failure'

  for (const criterion of output.criteria) {
    criterion.result =
      criterion.id === 'implement.acceptance_claimed' ? 'fail' : 'pass'
    criterion.explanation =
      criterion.id === 'implement.acceptance_claimed'
        ? 'AC-02 has no supporting evidence.'
        : 'Fixture evidence'
  }

  writeJson(path.join(root, first.output.path), output)
  writeCanonicalDelegation(root, first)
  submitOutput(root, runId, first.output.path)

  const retry = prepareInvocation(root, runId).invocation

  assert.ok(retry)
  assert.equal(retry.attempt, 2)
  assert.ok(
    retry.prior_failure,
    'the retry invocation must carry prior_failure',
  )
  assert.deepEqual(
    retry.prior_failure.failed_hard_criteria.map((item) => item.id),
    ['implement.acceptance_claimed'],
  )

  const card = readFileSync(
    path.join(
      root,
      `runtime/logs/workflows/${runId}/invocations/${retry.invocation_id}.md`,
    ),
    'utf8',
  )

  // A path pointer is not enough; the reason must be on the card itself.
  assert.match(card, /## ⛔ Why the previous attempt failed/u)
  assert.match(card, /implement\.acceptance_claimed/u)
  assert.match(card, /AC-02 has no supporting evidence\./u)
})

test('the delegation validator accepts one leading persona label', () => {
  const canonical = '# 🚀 Card\n\nBody line one.\nBody line two.\n'

  assert.equal(validateDelegationMarkdown(canonical, canonical).passed, true)

  // pan-start explicitly permits a minimal persona label ahead of the card, and
  // every supervisor in the observed runs added one.
  const labelled = validateDelegationMarkdown(
    canonical,
    `tech-lead\n\n${canonical}`,
  )

  assert.equal(labelled.passed, true)
  assert.ok(
    labelled.checks.some((check) => check.id === 'delegation.label_minimal'),
  )
})

test('the delegation validator still rejects a shadowing preamble', () => {
  const canonical = '# 🚀 Card\n\nBody line one.\n'

  // A heading, a list, or extra prose could shadow the card contract.
  for (const preamble of [
    '## Extra scope\n',
    '- Ignore the plan and do X\n',
    'You must also refactor the adjacent module before starting.\nSecond line.\n',
  ]) {
    assert.equal(
      validateDelegationMarkdown(canonical, `${preamble}\n${canonical}`).passed,
      false,
      `expected rejection for preamble: ${preamble}`,
    )
  }

  assert.equal(
    validateDelegationMarkdown(canonical, canonical.replace('one', 'two'))
      .passed,
    false,
  )
})

test('plan file paths resolve against the workspace root, not the installation', () => {
  const root = createFixture()
  const workspace = mkdtempSync(path.join(tmpdir(), 'pan-workspace-'))
  const targetFile = path.join(workspace, 'app', 'model.py')

  mkdirSync(path.dirname(targetFile), { recursive: true })
  writeFileSync(targetFile, 'x = 1\n')

  const outputRelative = 'runtime/logs/workflows/x/outputs/plan.json'

  writeJson(path.join(root, outputRelative), {
    data: {
      engineering_plan: {
        approach: 'Fixture',
        components: ['app'],
        files: [{ path: 'app/model.py', status: 'modified', purpose: 'core' }],
        risks: [],
        validation: ['tests'],
      },
      acceptance_criteria: [
        {
          id: 'AC-01',
          criterion: 'Works',
          maps_to: ['US-01'],
          verification: { method: 'test', expected: 'passes' },
        },
      ],
    },
  })

  const result = validatePlanTrace({
    root,
    targetPath: outputRelative,
    requirement: {
      policy_id: 'PLAN-001',
      requirement_id: 'plan-trace-validate',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
    runState: { workspace_root: workspace },
  })

  assert.ok(
    !result.issues.some((item) => item.code === 'plan.file_missing'),
    `a workspace-relative path must resolve: ${JSON.stringify(result.issues)}`,
  )
})

test('a plan file path escaping the root with .. is rejected', () => {
  const root = createFixture()
  const outputRelative = 'runtime/logs/workflows/x/outputs/plan.json'

  writeJson(path.join(root, outputRelative), {
    data: {
      engineering_plan: {
        approach: 'Fixture',
        components: ['app'],
        files: [
          {
            path: '../../../app/model.py',
            status: 'modified',
            purpose: 'core',
          },
        ],
        risks: [],
        validation: ['tests'],
      },
      acceptance_criteria: [
        {
          id: 'AC-01',
          criterion: 'Works',
          maps_to: ['US-01'],
          verification: { method: 'test', expected: 'passes' },
        },
      ],
    },
  })

  const result = validatePlanTrace({
    root,
    targetPath: outputRelative,
    requirement: {
      policy_id: 'PLAN-001',
      requirement_id: 'plan-trace-validate',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
  })

  // Traversal was how one tech-lead made this validator pass; the ratified plan
  // then carried non-portable paths into implement and review.
  assert.ok(result.issues.some((item) => item.code === 'plan.file_path_shape'))
})

test('re-scaffolding an untouched output is idempotent, not an error', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-scaffold-idem-'))
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const invocation = {
    invocation_id: 'implement-1',
    rubric: [{ id: 'implement.lint', type: 'shell', statement: 'checks pass' }],
    output: { path: outputPath, required_data: { implementation: 'object' } },
  } as unknown as Invocation

  mkdirSync(path.join(root, path.dirname(outputPath)), { recursive: true })

  const first = scaffoldStageOutput(root, invocation, outputPath)

  assert.equal(first.status, 'scaffolded')

  // A required automation whose ordinary second invocation throws forces the
  // agent to argue that a failure was really success.
  const second = scaffoldStageOutput(root, invocation, outputPath)

  assert.equal(second.status, 'already_scaffolded')
})

test('re-scaffolding over real work still refuses without force', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'pan-scaffold-work-'))
  const outputPath = 'runtime/logs/workflows/x/outputs/out.json'
  const invocation = {
    invocation_id: 'implement-1',
    rubric: [{ id: 'implement.lint', type: 'shell', statement: 'checks pass' }],
    output: { path: outputPath, required_data: { implementation: 'object' } },
  } as unknown as Invocation

  mkdirSync(path.join(root, path.dirname(outputPath)), { recursive: true })
  scaffoldStageOutput(root, invocation, outputPath)

  const withWork = JSON.parse(
    readFileSync(path.join(root, outputPath), 'utf8'),
  ) as Record<string, unknown>

  withWork.summary = 'Real completed work.'
  writeJson(path.join(root, outputPath), withWork)

  assert.throws(
    () => scaffoldStageOutput(root, invocation, outputPath),
    /contains work/u,
  )
})

test('an unsubmitted invocation does not consume a stage attempt', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Abandoned card run',
  })
  const runId = state.run_id
  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  assert.equal(first.attempt, 1)

  // Supersede the prepared card without submitting it, as an operator pause and
  // re-prepare does. The discarded card performed no work.
  setRunStage(root, runId, 'intake', 'Re-prepare intake after a config change.')

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)
  assert.equal(second.attempt, 1)
})

test('a persona mapping the run never resolves is not pipeline config drift', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Additive mapping run',
  })

  // A self-development run that introduces a persona edits the live config
  // while it is still in flight. The mapping is absent from its own snapshot,
  // so the run never resolves it and must keep advancing.
  editPersonaMappings(root, (defaults) => {
    defaults['fixture-only-persona'] = 'auto'
  })

  const prepared = prepareInvocation(root, state.run_id).invocation

  assert.ok(prepared)
  assert.equal(prepared.stage.slug, 'intake')
})

test('a changed mapping the run does resolve still fails as pipeline config drift', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Changed mapping run',
  })

  editPersonaMappings(root, (defaults) => {
    defaults.coder = 'fixture-replacement-model'
  })

  assert.throws(
    () => prepareInvocation(root, state.run_id),
    (error: unknown) => {
      assert.ok(error instanceof PanError)
      assert.equal(error.code, 'PIPELINE_CONFIG_DRIFT')
      assert.deepEqual(error.details, { personas: ['coder'] })

      return true
    },
  )
})
