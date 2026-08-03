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
import { loadPolicyCatalog } from '../../src/lib/policies.js'
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
 */
test('worker invocation cards unroll the supervisor delivery contract', () => {
  const root = createFixture()
  const workflow = loadWorkflow(root, 'dev')
  const invocationPolicy = loadPolicyCatalog(root).get('INVOCATION-001')

  assert.ok(invocationPolicy)

  const runId = createRun(root, {
    workflowSlug: 'dev',
    requestPath: 'request.md',
    title: 'Delegation contract run',
  }).run_id

  // Intake is supervisor-owned, so it carries no delivery contract.
  const intake = prepareInvocation(root, runId)

  assert.ok(intake.invocation)
  assert.equal(intake.invocation.delegation, undefined)
  assert.ok(
    !cardText(
      root,
      intake.state.current_invocation?.markdown_path ?? '',
    ).includes(DELEGATION_HEADING),
  )

  writeJson(
    path.join(root, intake.invocation.output.path),
    makeOutput(root, intake.invocation, stageBySlug(workflow, 'intake')),
  )
  submitOutput(root, runId, intake.invocation.output.path)
  decideRun(root, runId, 'approve', 'Fixture approval')

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation
  const delegation = invocation?.delegation

  assert.ok(invocation)
  assert.ok(delegation)

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
    delegation.cursor_agent_path,
    delegation.submit_command,
  ]) {
    assert.ok(markdown.includes(resolved), `card MUST resolve ${resolved}`)
  }

  const artifact = read(
    path.join(root, delegation.invocation_validation_path),
  ) as ValidationArtifact

  assert.equal(artifact.status, 'pass')
  assert.ok(artifact.checks.some((check) => check.id === 'delegation.heading'))

  // The contract survives real delivery: the copied prompt body still matches.
  writeCanonicalDelegation(root, invocation)
  assert.equal(
    validateDelegationMarkdown(
      markdown,
      cardText(root, delegation.delegation_artifact_path),
    ).passed,
    true,
  )
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
