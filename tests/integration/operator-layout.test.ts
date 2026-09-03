import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  decideRun,
  pauseRun,
  prepareInvocation,
  resumeRun,
  setRunStage,
  waiveGate,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  createRun,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  submitAsSupervisor,
} from '../helpers.js'

import type { Invocation, RunState } from '../../src/lib/types.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/** Every file in the run directory, relative to it, in stable order. */
function listRunFiles(runRootAbsolute: string): string[] {
  return readdirSync(runRootAbsolute, {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(runRootAbsolute, path.join(entry.parentPath, entry.name)),
    )
    .sort()
}

function prepareFirstStage(
  root: string,
  involvement: 'standard' | 'technical-director' = 'standard',
): {
  runId: string
  invocation: Invocation
} {
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    involvement,
    operatorArtifacts: true,
  }).run_id
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  return { runId, invocation }
}

/** Fill and submit the run's current invocation as a success. */
function submitStage(root: string, runId: string, invocation: Invocation) {
  const workflow = loadWorkflow(root, 'delivery')
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
  )

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  return submitAsSupervisor(root, runId, invocation.output.path)
}

test('submit reports the sole operator brief and removes its source', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const { runId, invocation } = prepareFirstStage(root)
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
  )

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  // The supervisor records the foreground return before it submits; without
  // the attestation `pan submit` refuses with DELEGATION_UNOBSERVED.
  execFileSync(
    process.execPath,
    [CLI, 'watch', runId, '--foreground-returned', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  const layout = resolveRunLayout(root, runId)
  const filesBefore = listRunFiles(layout.root.absolute)
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [CLI, 'submit', runId, invocation.output.path, '--json'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    ),
  ) as Record<string, unknown>
  const filesAfter = listRunFiles(layout.root.absolute)
  const operatorFiles = readdirSync(layout.operator.absolute)

  assert.equal(result.operator_brief_html, brief.rendered_path)
  assert.equal(existsSync(path.join(root, brief.source_path)), false)
  assert.deepEqual(
    operatorFiles.filter((entry) => entry.endsWith('.html')),
    [`${invocation.invocation_id}.html`],
  )
  assert.equal(
    operatorFiles.some((entry) => entry.endsWith('.json')),
    false,
  )

  assert.deepEqual(readdirSync(layout.root.absolute).sort(), [
    'agent',
    'operator',
  ])
  assert.deepEqual([...operatorFiles].sort(), [
    `${invocation.invocation_id}.html`,
    'request.md',
  ])

  const agentEntries = readdirSync(layout.agent.absolute)

  assert.ok(agentEntries.includes('state.json'))
  assert.ok(agentEntries.includes('events.jsonl'))
  assert.ok(agentEntries.includes('outputs'))
  assert.equal(
    agentEntries.some((entry) => entry.endsWith('.html')),
    false,
  )

  // The complete before-and-after inventory proves submission removes the
  // brief source without a compensating file anywhere in the run directory.
  const briefSourceRelative = path.relative(
    layout.root.absolute,
    path.join(root, brief.source_path),
  )
  const removed = filesBefore.filter((file) => !filesAfter.includes(file))
  const added = filesAfter.filter((file) => !filesBefore.includes(file))

  assert.deepEqual(removed, [briefSourceRelative])
  // The fixture pre-renders the HTML, so submission re-renders it in place.
  // Provenance and validation evidence exist under either brief contract.
  // Large state revisions can also externalize into a content-addressed record.
  const stateRevisions = added.filter((file) =>
    /^agent\/artifacts\/json\/state-revision-\d+-[a-f0-9]{64}\.json$/u.test(
      file,
    ),
  )
  const nonStateAdditions = added.filter(
    (file) => !stateRevisions.includes(file),
  )

  assert.ok(stateRevisions.length <= 1)
  assert.deepEqual(nonStateAdditions, [
    `agent/artifacts/json/${invocation.invocation_id}.json`,
    `agent/evidence/${invocation.invocation_id}-implement.lint.log`,
    `agent/evidence/${invocation.invocation_id}-implement.unit_tests.log`,
    `agent/validations/${invocation.invocation_id}.attestation-validation.json`,
    `agent/validations/${invocation.invocation_id}.delegation-validation.json`,
    'agent/validations/DEV-001-implementation-claims-validate-harness.json',
    'agent/validations/DEV-001-target-instruction-coverage-validate-harness.json',
    'agent/validations/GLOBAL-001-operator-artifact-validate-harness.json',
    'agent/validations/STE-001-simplified-english-validate-harness.json',
  ])
  assert.ok(filesAfter.includes(`operator/${invocation.invocation_id}.html`))
  assert.equal(
    filesAfter.filter((file) => file.endsWith('.brief.json')).length,
    0,
  )

  const state = JSON.parse(
    readFileSync(layout.state.absolute, 'utf8'),
  ) as RunState
  const briefSourceRecord = state.stage_history.at(-1)?.operator_brief_source

  assert.ok(briefSourceRecord)
  assert.equal(briefSourceRecord.status, 'rendered_and_validated')
  assert.equal(briefSourceRecord.source_path, brief.source_path)
  assert.match(briefSourceRecord.source_sha256, /^[a-f0-9]{64}$/u)
})

// A default run suppresses operator artifacts, so its complete file inventory
// must gain machine records only: no brief source, no stage HTML, no PR copy.
test('a default run prepares and submits without any brief file', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    involvement: 'standard',
  }).run_id
  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)
  assert.equal(invocation.output.operator_brief, undefined)

  const layout = resolveRunLayout(root, runId)
  const filesBefore = listRunFiles(layout.root.absolute)
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
  )

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  submitAsSupervisor(root, runId, invocation.output.path)

  const filesAfter = listRunFiles(layout.root.absolute)
  const added = filesAfter.filter((file) => !filesBefore.includes(file))

  assert.deepEqual(readdirSync(layout.operator.absolute), ['request.md'])
  assert.equal(
    filesAfter.some(
      (file) => file.endsWith('.brief.json') || file.endsWith('.html'),
    ),
    false,
    `run tree holds no brief file: ${filesAfter.join(', ')}`,
  )
  assert.ok(added.some((file) => file.includes('outputs/')))
  assert.ok(existsSync(layout.state.absolute))
  assert.ok(existsSync(layout.events.absolute))
})

// The operator directory holds only the request, stage HTML narratives, and
// ship-produced operator Markdown. Every operator control record — rejection
// feedback, stage-repair feedback, pause ratifications, and gate waivers —
// belongs beside the decision records under agent/decisions/.
test('operator control records stay out of the operator directory', () => {
  const root = createFixture()
  // The technical-director contract gates verify, which gives the run an
  // operator gate to reject at.
  const { runId, invocation } = prepareFirstStage(root, 'technical-director')

  submitStage(root, runId, invocation)

  const verifyInvocation = prepareInvocation(root, runId).invocation

  assert.ok(verifyInvocation)
  submitStage(root, runId, verifyInvocation)

  // Rejection feedback at the verify operator gate.
  decideRun(root, runId, 'reject', 'Re-verify with narrower scope.')

  // Stage-repair feedback from an operator-directed stage change.
  setRunStage(root, runId, 'implement', 'Initialize tracked workspace state.')

  // A workspace ratification for an edit made during an operator pause.
  pauseRun(root, runId, 'Operator will edit one tracked file.')
  writeFileSync(
    path.join(root, 'src', 'base.ts'),
    'export const base = true\nexport const operatorFix = true\n',
  )

  const resumed = resumeRun(root, runId)

  assert.equal(resumed.operator_workspace_ratifications?.length, 1)

  // A gate waiver recorded as an operator directive.
  pauseRun(root, runId, 'Operator adjudicates the implement gate.')

  const waived = waiveGate(root, runId, {
    stageSlug: 'implement',
    note: 'The implement gate is waived for this layout fixture.',
  })
  const layout = resolveRunLayout(root, runId)
  const state = JSON.parse(
    readFileSync(layout.state.absolute, 'utf8'),
  ) as RunState
  const controlPaths = [
    ...(state.operator_feedback ?? []).map((item) => item.path),
    ...(state.operator_workspace_ratifications ?? []).map(
      (item) => item.artifact_path,
    ),
    waived.waiver.artifact_path,
  ]

  assert.equal(state.operator_feedback?.length, 2)

  for (const controlPath of controlPaths) {
    assert.ok(
      controlPath.startsWith(`${layout.agent.relative}/decisions/`),
      `${controlPath} MUST live under agent/decisions/`,
    )
    assert.ok(existsSync(path.join(root, controlPath)))
  }

  assert.deepEqual(readdirSync(layout.operator.absolute).sort(), [
    `${verifyInvocation.invocation_id}.html`,
    `${invocation.invocation_id}.html`,
    'request.md',
  ])
})

// The brief source is the only diagnostic copy of an unrenderable or invalid
// narrative, so submission keeps it whenever the render or a validator fails.
test('a submission with validation errors keeps the brief source', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'delivery')
  const { runId, invocation } = prepareFirstStage(root)
  const brief = invocation.output.operator_brief

  assert.ok(brief)
  const output = makeOutput(
    root,
    invocation,
    stageBySlug(workflow, invocation.stage.slug),
  )

  output.invocation_id = 'wrong-invocation-id'

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)
  const layout = resolveRunLayout(root, runId)
  const state = JSON.parse(
    readFileSync(layout.state.absolute, 'utf8'),
  ) as RunState

  assert.ok(submitted.record.evaluation.validation_errors.length > 0)
  assert.equal(existsSync(path.join(root, brief.source_path)), true)
  assert.equal(state.stage_history.at(-1)?.operator_brief_source, undefined)
})
