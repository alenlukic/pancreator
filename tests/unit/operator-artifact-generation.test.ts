import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { generateOperatorArtifacts } from '../../src/lib/operator-artifact-generation.js'
import {
  generatedOperatorBrief,
  OPERATOR_ARTIFACT_PROFILE_HEADINGS,
} from '../../src/lib/operator-artifact-profiles.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

test('every workflow artifact profile maps canonical data into required sections', () => {
  for (const profile of Object.keys(
    OPERATOR_ARTIFACT_PROFILE_HEADINGS,
  ) as Array<keyof typeof OPERATOR_ARTIFACT_PROFILE_HEADINGS>) {
    if (
      profile === 'investigation' ||
      profile === 'spotfix' ||
      profile === 'escalation'
    ) {
      continue
    }

    const brief = generatedOperatorBrief({
      profile,
      title: `${profile} brief`,
      source: `run/${profile}`,
      stageTitle: profile,
      outcome: 'success',
      summary: 'The canonical stage record contains the generated brief data.',
      data: {},
      risks: [],
      unknowns: [],
    })
    const titles = brief.sections.map((section) => section.title.toLowerCase())

    for (const heading of OPERATOR_ARTIFACT_PROFILE_HEADINGS[profile]) {
      assert.ok(titles.some((title) => title.includes(heading)))
    }
  }
})

function submitSuppressedIntake(root: string): {
  runId: string
  invocationId: string
} {
  const workflow = loadWorkflow(root, 'dev')
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })
  const invocation = prepareInvocation(root, state.run_id).invocation

  assert.ok(invocation)
  assert.equal(invocation.output.operator_brief, undefined)

  const output = makeOutput(root, invocation, stageBySlug(workflow, 'intake'))

  writeJson(path.join(root, invocation.output.path), output)
  writeCanonicalDelegation(root, invocation)
  submitOutput(root, state.run_id, invocation.output.path)

  return { runId: state.run_id, invocationId: invocation.invocation_id }
}

test('post-stage generation creates validated HTML from canonical records', () => {
  const root = createFixture()
  const { runId, invocationId } = submitSuppressedIntake(root)
  const result = generateOperatorArtifacts(root, {
    runId,
    stage: 'intake',
  })
  const artifact = result.artifacts[0]

  assert.equal(artifact?.status, 'generated')
  assert.match(artifact?.html_sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.match(artifact?.source_sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.ok(
    artifact?.validation_paths?.some((entry) =>
      entry.includes('GLOBAL-001-operator-artifact-validate'),
    ),
  )

  const layout = resolveRunLayout(root, runId)
  const htmlPath = layout.operatorHtml(invocationId).absolute
  const sourcePath = layout.artifactJson(`${invocationId}.brief.json`).absolute

  assert.equal(existsSync(htmlPath), true)
  assert.equal(existsSync(sourcePath), false)
  assert.match(readFileSync(htmlPath, 'utf8'), /class="pc-brief"/u)
  assert.match(
    readFileSync(layout.events.absolute, 'utf8'),
    /operator_artifacts_generated/u,
  )

  const repeated = generateOperatorArtifacts(root, {
    runId,
    stage: 'intake',
  })

  assert.equal(repeated.artifacts[0]?.status, 'skipped')
})

test('generation without a stage covers missing briefs and force replaces', () => {
  const root = createFixture()
  const { runId, invocationId } = submitSuppressedIntake(root)
  const initial = generateOperatorArtifacts(root, { runId })

  assert.equal(initial.artifacts.length, 1)
  assert.equal(initial.artifacts[0]?.stage, 'intake')
  assert.equal(initial.artifacts[0]?.status, 'generated')

  const repeated = generateOperatorArtifacts(root, { runId })

  assert.equal(repeated.artifacts[0]?.status, 'skipped')

  const forced = generateOperatorArtifacts(root, { runId, force: true })

  assert.equal(forced.artifacts[0]?.status, 'generated')

  const layout = resolveRunLayout(root, runId)

  assert.equal(existsSync(layout.operatorHtml(invocationId).absolute), true)
})

test('forced generation preserves existing HTML and source after render failure', () => {
  const root = createFixture()
  const { runId, invocationId } = submitSuppressedIntake(root)
  const layout = resolveRunLayout(root, runId)
  const htmlPath = layout.operatorHtml(invocationId).absolute
  const sourcePath = layout.artifactJson(`${invocationId}.brief.json`).absolute
  const temporaryPath = layout.artifactJson(
    `${invocationId}.generated.tmp.html`,
  ).absolute

  writeFileSync(htmlPath, 'existing curated html\n', 'utf8')
  mkdirSync(temporaryPath)

  assert.throws(
    () =>
      generateOperatorArtifacts(root, {
        runId,
        stage: 'intake',
        force: true,
      }),
    /directory|EISDIR|ENOTDIR/u,
  )
  assert.equal(readFileSync(htmlPath, 'utf8'), 'existing curated html\n')
  assert.equal(existsSync(sourcePath), true)
})

test('generation rejects unknown and unsubmitted stages with stable codes', () => {
  const root = createFixture()
  const state = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
  })

  assert.throws(
    () =>
      generateOperatorArtifacts(root, {
        runId: state.run_id,
        stage: 'unknown',
      }),
    (error: unknown) => isCodedError(error, 'OPERATOR_ARTIFACT_STAGE_UNKNOWN'),
  )
  assert.throws(
    () =>
      generateOperatorArtifacts(root, {
        runId: state.run_id,
        stage: 'plan',
      }),
    (error: unknown) =>
      isCodedError(error, 'OPERATOR_ARTIFACT_STAGE_UNSUBMITTED'),
  )
})

function isCodedError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: string }).code === code
  )
}
