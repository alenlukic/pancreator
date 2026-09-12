import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation, setRunStage } from '../../src/lib/engine.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
} from '../../src/lib/render.js'
import {
  DELEGATION_HEADING,
  validateDelegationMarkdown,
} from '../../src/lib/validation.js'
import {
  createFixture,
  createRun,
  read,
  writeCanonicalDelegation,
} from '../helpers.js'

interface ValidationArtifact {
  status: string
  checks: Array<{ id: string; passed: boolean; message: string }>
}

const REPO_ROOT = process.cwd()

function repoText(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

test('always-applied rules share one supervisor paragraph', () => {
  const paragraphs = [
    'library/cursor/rules/pancreator-self-development.mdc',
    'library/cursor/rules/pancreator-embedded.mdc',
  ].map((rulePath) => {
    const body = repoText(rulePath)
    const paragraph = body
      .split(/\n\s*\n/u)
      .find((candidate) =>
        /A workflow supervisor MUST run in the operator's own session/u.test(
          candidate,
        ),
      )

    assert.ok(paragraph, `${rulePath} MUST state where the supervisor runs`)
    assert.match(
      paragraph,
      /you MUST refuse before calling the subagent/u,
      `${rulePath} MUST require refusal of injected supervisor delegation`,
    )

    return paragraph.trim()
  })

  assert.equal(paragraphs[0], paragraphs[1])
})

function cardText(root: string, markdownPath: string): string {
  return readFileSync(path.join(root, markdownPath), 'utf8')
}

/**
 * The supervisor delegates from the continuation loop, where it holds no card
 * of its own. These assertions pin the delivery contract to the sibling
 * supervisor procedure document the card names, so compliance never depends
 * on recalling `AGENTS.md` — while the worker-visible card itself carries no
 * workflow lifecycle command. Delivery implement is the first delegated
 * stage, so the run has no supervisor-owned stage to fall back on.
 */
test('worker invocation cards point at the supervisor delivery procedure', () => {
  const root = createFixture()

  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Delegation contract run',
  }).run_id

  // Implement is the first delegated worker stage, so the contract must
  // already hold on the very first card the supervisor delivers.
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation
  const delegation = invocation?.delegation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'implement')
  assert.equal(invocation.stage.persona, 'coder')
  assert.ok(delegation)
  assert.equal(delegation.cursor_agent_path, '.cursor/agents/pan-coder.md')

  const markdown = cardText(
    root,
    prepared.state.current_invocation?.markdown_path ?? '',
  )

  assert.ok(markdown.includes(DELEGATION_HEADING))
  assert.ok(delegation.supervisor_procedure_path)
  assert.ok(
    markdown.includes(delegation.supervisor_procedure_path),
    'card MUST name the supervisor procedure document',
  )

  // Lifecycle commands are supervisor-owned: the worker-visible card must not
  // print any of them, above all the submit command.
  assert.ok(
    !markdown.includes(delegation.submit_command),
    'card MUST NOT print the submit command',
  )
  assert.ok(
    !/pan\s+(submit|decide|set-stage|waive-gate|delegate|abort)\b/u.test(
      markdown,
    ),
    'card MUST NOT print a workflow lifecycle command',
  )

  const procedure = cardText(root, delegation.supervisor_procedure_path)

  assert.ok(procedure.includes(DELEGATION_HEADING))

  const sections = delegation.supervisor_card?.policy_sections ?? []
  const invocationDigest =
    sections.find((section) => section.policy_id === 'INVOCATION-001')
      ?.sha256 ?? null

  assert.ok(invocationDigest, 'INVOCATION-001 section digest is present')
  assert.ok(
    procedure.includes(`\`INVOCATION-001\`: \`sha256:${invocationDigest}\``),
    'procedure MUST point at the INVOCATION-001 digest',
  )

  // Resolved for this invocation, so no path has to be derived.
  for (const resolved of [
    delegation.canonical_markdown_path,
    delegation.invocation_validation_path,
    delegation.delegation_artifact_path,
    delegation.cursor_agent_path ?? '',
    delegation.submit_command,
    delegation.delivery_prompt_path ?? '',
  ]) {
    assert.ok(
      procedure.includes(resolved),
      `procedure MUST resolve ${resolved}`,
    )
  }

  const artifact = read(
    path.join(root, delegation.invocation_validation_path),
  ) as ValidationArtifact

  assert.equal(artifact.status, 'pass')
  assert.ok(artifact.checks.some((check) => check.id === 'delegation.heading'))
  assert.ok(
    artifact.checks.some(
      (check) => check.id === 'delegation.worker_isolation' && check.passed,
    ),
  )
  assert.ok(
    artifact.checks.some(
      (check) => check.id === 'delegation.procedure_document' && check.passed,
    ),
  )

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

  // The delivery prompt size must not grow with the contract body.
  const manifest = invocation.contract_manifest

  assert.ok(manifest)

  const contract = cardText(root, manifest.contract_path)
  const prompt = cardText(root, delegation.delivery_prompt_path)
  const grown = `${contract}${'Filler contract body line.\n'.repeat(4_000)}`
  const grownPrompt = renderInvocationDeliveryPrompt(
    invocation,
    buildInvocationContractManifest(manifest.contract_path, grown),
  )

  assert.ok(prompt.length < contract.length)
  assert.ok(grown.length > contract.length * 2)
  assert.ok(grownPrompt.length < prompt.length + 100)
})

// Run 63310 genre-label HR-004: the verify invocation defined two evidence
// workers that had to finish first, and its operator-facing next action still
// said to launch the verifier. The supervisor followed the prominent action,
// the verifier found no reports, and the run spent an attempt on a delivery
// defect. A call to action must name the first executable step in the
// invocation's real dependency graph.
test('an invocation with evidence workers names them before the consolidator', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Evidence worker ordering run',
  }).run_id

  // Verify is the delivery stage that declares parallel evidence workers.
  setRunStage(root, runId, 'verify', 'regression: reach the evidence stage')

  const invocation = prepareInvocation(root, runId).invocation

  assert.ok(invocation)

  const workers = invocation.evidence_workers ?? []

  assert.ok(workers.length > 0, 'the fixture must reach an evidence stage')

  const nextAction = invocation.$operator.next_action

  for (const worker of workers) {
    assert.ok(
      nextAction.includes(worker.agent),
      `the next action MUST name evidence worker ${worker.agent}`,
    )
  }

  assert.ok(
    nextAction.indexOf(workers[0].agent) <
      nextAction.indexOf(`persona '${invocation.stage.persona}'`),
    'evidence workers MUST come before the consolidating worker',
  )
})
