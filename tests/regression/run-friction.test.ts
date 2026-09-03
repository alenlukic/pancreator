import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  getRunState,
  prepareInvocation,
  setRunStage,
} from '../../src/lib/engine.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import { resolveRequirements } from '../../src/lib/requirements/resolve.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  validateDelegationMarkdown,
  validateStageOutput,
} from '../../src/lib/validation.js'
import { scaffoldStageOutput } from '../../src/lib/requirements/scaffold.js'
import { validatePlanTrace } from '../../src/lib/validators/stage-validators.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'
import type { Invocation } from '../../src/lib/types.js'

const REPO_ROOT = process.cwd()

/**
 * Regressions for the mechanical friction found in the detached target runs.
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
  const workflow = loadWorkflow(REPO_ROOT, 'planning')
  const stage = stageBySlug(workflow, 'plan')
  const scope = {
    persona: stage.persona,
    workflow: workflow.slug,
    stage: stage.slug,
  }
  const outputPath = 'runtime/logs/workflows/x/outputs/plan.json'
  const invocation = {
    $operator: { headline: 'Test', summary: 'Test', next_action: 'Submit' },
    schema_version: 1,
    invocation_id: 'plan-1-test',
    run_id: 'run-test',
    attempt: 1,
    created_at: new Date().toISOString(),
    workspace_root: '.',
    workflow: { slug: workflow.slug, snapshot_path: 'x', snapshot_sha256: 'y' },
    stage: {
      slug: stage.slug,
      title: stage.title,
      persona: stage.persona,
      model: 'test',
      model_config: 'test',
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    },
    prompt: 'Do work',
    inputs: { references: [] },
    policies: resolvePolicies(REPO_ROOT, scope),
    requirements: resolveRequirements(REPO_ROOT, {
      ...scope,
      invocation: { output_path: outputPath },
    }),
    rubric: stage.criteria,
    output: {
      path: outputPath,
      template: 'library/templates/stage-output.example.json',
      schema: 'library/schemas/stage-output.schema.json',
      required_data: stage.required_data ?? {},
    },
    boundaries: [],
    workspace_before: { kind: 'git', fingerprint: 'abc', entries: [] },
  } satisfies Invocation
  const criterion = stage.criteria[0]

  assert.ok(criterion)

  // A model writing "partial" previously coerced to fail with no diagnostic,
  // so the retry could not tell what to fix and repeated the same mistake.
  const validation = validateStageOutput(REPO_ROOT, stage, invocation, {
    criteria: [{ id: criterion.id, result: 'partial' }],
  })

  assert.ok(
    validation.errors.some(
      (message) =>
        message.includes(criterion.id) && message.includes('"partial"'),
    ),
    `expected an explicit verdict error, got: ${validation.errors.join(' | ')}`,
  )
})

test('writes new inbox items to queue', () => {
  const producerPaths = [
    'bin/install',
    'governance/policies/ORCH-001.json',
    'governance/policies/SPOT-001.json',
    'library/cursor/agents/decomposer.md',
    'library/cursor/agents/harness-technician.md',
    'library/cursor/agents/meta-orchestrator.md',
    'library/cursor/agents/spotfixer.md',
    'library/cursor/commands/pan-debug.md',
    'library/cursor/commands/pan-decompose.md',
    'library/cursor/commands/pan-qa-workflow.md',
    'library/cursor/commands/pan-repair.md',
    'library/cursor/commands/pan-review.md',
    'library/cursor/commands/pan-shepherd.md',
    'library/cursor/commands/pan-spotfix.md',
    'library/cursor/commands/pan-start.md',
    'library/personas/decomposer.md',
    'library/personas/harness-technician.md',
    'library/personas/harness-workflow-qa.md',
    'library/personas/orchestrator.md',
    'library/personas/spotfixer.md',
    'library/skills/prompt-augmentation.md',
    'library/skills/spotfix.md',
    'library/templates/detached-AGENTS.md',
    'library/templates/embedded-AGENTS.md',
  ]

  for (const producerPath of producerPaths) {
    const content = readFileSync(path.join(REPO_ROOT, producerPath), 'utf8')

    assert.match(
      content,
      /runtime\/inbox\/queue\//u,
      `${producerPath} must route new inbox items to queue`,
    )
  }
})

test('a retry card inlines the recorded reason the prior attempt failed', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const state = createRun(root, {
    workflowSlug: 'delivery',
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
  submitAsSupervisor(root, runId, first.output.path)

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
    resolveRunLayout(root, runId).invocation(retry.invocation_id, '.md')
      .absolute,
    'utf8',
  )

  // A path pointer is not enough; the reason must be on the card itself.
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
    `planner\n\n${canonical}`,
  )

  assert.equal(labelled.passed, true)
  assert.ok(
    labelled.checks.some((check) => check.id === 'delegation.label_minimal'),
  )

  // The delivered body itself begins with a harness-generated `Persona:` line
  // under referenced delivery; run 63316 supervisors prepended both identity
  // lines and every otherwise correct delegation warned (GA-0001..GA-0010).
  const referenced = 'Persona: `coder`.\n\nBody line one.\nBody line two.\n'
  const paired = validateDelegationMarkdown(
    referenced,
    `Agent: pan-coder\nPersona: \`coder\`.\n\n${referenced}`,
    'referenced',
  )

  assert.equal(paired.passed, true)
  assert.ok(
    paired.checks.some((check) => check.id === 'delegation.label_minimal'),
  )

  // A lone Agent label still qualifies via the single-line grammar even
  // though the body's own first line is a Persona line.
  assert.equal(
    validateDelegationMarkdown(
      referenced,
      `Agent: pan-coder\n\n${referenced}`,
      'referenced',
    ).passed,
    true,
  )

  // Two-line prose does not qualify: only Agent:/Persona: identity lines may
  // stack, so a parallel instruction cannot ride in as a "label".
  assert.equal(
    validateDelegationMarkdown(
      referenced,
      `Refactor the module first\nThen follow the card\n\n${referenced}`,
      'referenced',
    ).passed,
    false,
  )

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
  const sibling = mkdtempSync(path.join(tmpdir(), 'pan-sibling-repo-'))
  const siblingFile = path.join(sibling, 'model.py')

  mkdirSync(path.dirname(targetFile), { recursive: true })
  writeFileSync(targetFile, 'x = 1\n')
  writeFileSync(siblingFile, 'print("sibling")\n')

  const outputRelative = 'runtime/logs/workflows/x/outputs/plan.json'

  writeJson(path.join(root, outputRelative), {
    data: {
      engineering_plan: {
        approach: 'Fixture',
        components: ['app'],
        files: [
          // A workspace-relative path resolves against `workspace_root`, not
          // the installation root.
          { path: 'app/model.py', status: 'modified', purpose: 'core' },
          // An absolute path into a sibling repository, exactly as run
          // 63315's plan 97_plan-2_b898a4d1 declared it.
          { path: siblingFile, status: 'modified', purpose: 'core' },
          {
            path: '../nonexistent/app/model.py',
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
      policy_id: 'PLAN-002',
      requirement_id: 'plan-trace-validate',
      registry_id: 'PLAN-TRACE-VALIDATE-001',
      arguments: {},
    },
    runState: { workspace_root: workspace },
  })
  const missing = result.issues.filter(
    (item) => item.code === 'plan.file_missing',
  )

  // Any path that resolves on this system is valid, absolute or relative;
  // the only gate is existence for files not marked new. Downstream
  // target-instruction resolution consumes the same paths without rejecting
  // them, so an accepted plan can no longer fail implement preparation with
  // TARGET_INSTRUCTION_PATH_INVALID.
  assert.ok(!result.issues.some((item) => item.code === 'plan.file_path_shape'))
  assert.ok(
    !missing.some(
      (item) =>
        item.message.includes('app/model.py') &&
        !item.message.includes('../nonexistent'),
    ),
    `a workspace-relative path must resolve: ${JSON.stringify(result.issues)}`,
  )
  assert.ok(!missing.some((item) => item.message.includes(siblingFile)))
  assert.ok(
    missing.some((item) =>
      item.message.includes('../nonexistent/app/model.py'),
    ),
  )
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
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Abandoned card run',
  })
  const runId = state.run_id
  const first = prepareInvocation(root, runId).invocation

  assert.ok(first)
  assert.equal(first.attempt, 1)

  // Supersede the prepared card without submitting it, as an operator pause and
  // re-prepare does. The discarded card performed no work.
  setRunStage(
    root,
    runId,
    'implement',
    'Re-prepare implement after a config change.',
  )

  const second = prepareInvocation(root, runId).invocation

  assert.ok(second)
  assert.equal(second.attempt, 1)
})

test('a persona mapping the run never resolves is not pipeline config drift', () => {
  const root = createFixture()
  const additive = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Additive mapping run',
  })
  const changed = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Changed mapping run',
  })

  // A self-development run that introduces a persona edits the live config
  // while it is still in flight. The mapping is absent from its own snapshot,
  // so the run never resolves it and must keep advancing.
  editPersonaMappings(root, (defaults) => {
    defaults['fixture-only-persona'] = 'auto'
  })

  const prepared = prepareInvocation(root, additive.run_id).invocation

  assert.ok(prepared)
  assert.equal(prepared.stage.slug, 'implement')

  editPersonaMappings(root, (defaults) => {
    defaults.coder = 'gpt-5.4'
  })

  const drifted = prepareInvocation(root, changed.run_id)

  assert.ok(drifted.invocation)
  assert.ok(
    drifted.advisories.some(
      (advisory) =>
        advisory.includes('coder') &&
        advisory.includes('live model mapping changed'),
    ),
    `expected a coder drift advisory, got ${JSON.stringify(drifted.advisories)}`,
  )

  // The advisory must reach run state. `pan status` reads run state, not
  // stdout.
  assert.ok(
    (getRunState(root, changed.run_id).advisories ?? []).some(
      (advisory) =>
        advisory.kind === 'pipeline_config' &&
        advisory.source === 'prepare' &&
        advisory.message.includes('coder'),
    ),
    'the prepare-time pipeline advisory must persist to run state',
  )
})
