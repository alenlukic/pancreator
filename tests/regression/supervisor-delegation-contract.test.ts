import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  createRun,
  decideRun,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { sha256 } from '../../src/lib/io.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
  splitInvocationContract,
} from '../../src/lib/render.js'
import {
  DELEGATION_HEADING,
  validateDelegationMarkdown,
} from '../../src/lib/validation.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import {
  createFixture,
  makeOutput,
  read,
  writeCanonicalDelegation,
  writeJson,
} from '../helpers.js'

interface ValidationArtifact {
  status: string
  checks: Array<{ id: string; passed: boolean; message: string }>
}

function cardText(root: string, markdownPath: string): string {
  return readFileSync(path.join(root, markdownPath), 'utf8')
}

/**
 * The supervisor delegates from the continuation loop, where it holds no card
 * of its own. These assertions pin the delivery contract to the artifact it
 * must already read, so compliance never depends on recalling `AGENTS.md`.
 * Dev intake is the first delegated stage, so the run has no supervisor-owned
 * stage to fall back on.
 */
test('worker invocation cards inline the supervisor delivery contract', () => {
  const root = createFixture()
  const invocationPolicy = loadPolicyCatalog(root).get('INVOCATION-001')

  assert.ok(invocationPolicy)

  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Delegation contract run',
  }).run_id

  // Intake is the first delegated worker stage, so the contract must already
  // hold on the very first card the supervisor delivers.
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation
  const delegation = invocation?.delegation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'intake')
  assert.equal(invocation.stage.persona, 'intake-writer')
  assert.ok(delegation)
  assert.equal(
    delegation.cursor_agent_path,
    '.cursor/agents/pan-intake-writer.md',
  )

  const markdown = cardText(
    root,
    prepared.state.current_invocation?.markdown_path ?? '',
  )

  assert.ok(markdown.includes(DELEGATION_HEADING))

  // The whole policy, not a pointer to it.
  for (const instruction of invocationPolicy.instructions) {
    assert.ok(
      markdown.includes(instruction),
      `card MUST inline INVOCATION-001 instruction: ${instruction}`,
    )
  }

  // Resolved for this invocation, so no path has to be derived.
  for (const resolved of [
    delegation.canonical_markdown_path,
    delegation.invocation_validation_path,
    delegation.delegation_artifact_path,
    delegation.cursor_agent_path ?? '',
    delegation.submit_command,
    delegation.delivery_prompt_path ?? '',
  ]) {
    assert.ok(markdown.includes(resolved), `card MUST resolve ${resolved}`)
  }

  const artifact = read(
    path.join(root, delegation.invocation_validation_path),
  ) as ValidationArtifact

  assert.equal(artifact.status, 'pass')
  assert.ok(artifact.checks.some((check) => check.id === 'delegation.heading'))

  // The contract survives real delivery: the copied prompt body still matches.
  assert.equal(delegation.mode, 'referenced')
  assert.ok(delegation.delivery_prompt_path)
  writeCanonicalDelegation(root, invocation)
  assert.equal(
    validateDelegationMarkdown(
      cardText(root, delegation.delivery_prompt_path),
      cardText(root, delegation.delegation_artifact_path),
      'referenced',
    ).passed,
    true,
  )
})

/**
 * A supervisor cannot reproduce a card that exceeds its own output budget, so
 * delivery size must not scale with the contract. These assertions pin the
 * bounded prompt, the flat section index, and the digests that let a worker prove
 * it read the whole contract.
 */
test('referenced delivery stays bounded and flat as the contract grows', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Bounded delivery run',
  }).run_id
  const intake = prepareInvocation(root, runId)

  assert.ok(intake.invocation)
  writeJson(
    path.join(root, intake.invocation.output.path),
    makeOutput(root, intake.invocation, stageBySlug(workflow, 'intake')),
  )
  writeCanonicalDelegation(root, intake.invocation)
  submitOutput(root, runId, intake.invocation.output.path)
  decideRun(root, runId, 'approve', 'Fixture approval')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation?.delegation?.delivery_prompt_path)

  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const contract = cardText(root, manifest.contract_path)
  const prompt = cardText(root, invocation.delegation.delivery_prompt_path)

  // The manifest describes the contract that is actually on disk.
  assert.equal(manifest.contract_sha256, sha256(contract))
  assert.equal(manifest.byte_length, Buffer.byteLength(contract, 'utf8'))

  // Concatenating the sections reproduces the contract, so a section digest and
  // the whole-file digest describe the same bytes.
  const blocks = splitInvocationContract(contract)

  assert.equal(blocks.map((block) => block.markdown).join(''), contract)
  assert.equal(blocks.length, manifest.sections.length)

  // One flat index: every section appears exactly once, with its owner.
  for (const section of manifest.sections) {
    assert.equal(
      prompt.split(section.sha256).length - 1,
      1,
      `prompt MUST list section ${section.id} exactly once`,
    )
  }

  assert.ok(manifest.sections.some((section) => section.owner === 'worker'))
  assert.ok(manifest.sections.some((section) => section.owner === 'supervisor'))
  assert.ok(prompt.includes(manifest.contract_sha256))
  assert.ok(prompt.length < contract.length)

  // Growing the contract body does not grow the prompt.
  const grown = `${contract}${'Filler contract body line.\n'.repeat(4_000)}`
  const grownPrompt = renderInvocationDeliveryPrompt(
    invocation,
    buildInvocationContractManifest(manifest.contract_path, grown),
  )

  assert.ok(grown.length > contract.length * 2)
  assert.ok(grownPrompt.length < prompt.length + 100)
})

test('a delegation artifact that drops the delivery section fails validation', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Stripped delegation run',
  }).run_id

  const intake = prepareInvocation(root, runId)

  assert.ok(intake.invocation)
  writeJson(
    path.join(root, intake.invocation.output.path),
    makeOutput(root, intake.invocation, stageBySlug(workflow, 'intake')),
  )
  writeCanonicalDelegation(root, intake.invocation)
  submitOutput(root, runId, intake.invocation.output.path)
  decideRun(root, runId, 'approve', 'Fixture approval')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation?.delegation)

  const canonical = cardText(
    root,
    invocation.delegation.canonical_markdown_path,
  )
  const stripped = canonical.slice(0, canonical.indexOf(DELEGATION_HEADING))

  writeFileSync(
    path.join(root, invocation.delegation.delegation_artifact_path),
    stripped,
  )

  assert.equal(
    validateDelegationMarkdown(canonical, stripped).passed,
    false,
    'stripping the delivery procedure MUST break canonical equality',
  )
  assert.equal(validateDelegationMarkdown(canonical, canonical).passed, true)
})
