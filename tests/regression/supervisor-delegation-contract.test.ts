import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun, prepareInvocation } from '../../src/lib/engine.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  buildInvocationContractManifest,
  renderInvocationDeliveryPrompt,
} from '../../src/lib/render.js'
import {
  DELEGATION_HEADING,
  validateDelegationMarkdown,
} from '../../src/lib/validation.js'
import { createFixture, read, writeCanonicalDelegation } from '../helpers.js'

interface ValidationArtifact {
  status: string
  checks: Array<{ id: string; passed: boolean; message: string }>
}

const REPO_ROOT = process.cwd()

function repoText(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

function markdownFiles(directory: string): string[] {
  return readdirSync(path.join(REPO_ROOT, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.join(directory, entry.name)

      return entry.isDirectory()
        ? markdownFiles(relative)
        : entry.isFile() && entry.name.endsWith('.md')
          ? [relative]
          : []
    })
    .sort()
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

test('operator documentation contains no nested supervisor relay', () => {
  const relayPatterns = [
    /invoke the `pan-orchestrator` subagent/iu,
    /launch the `pan-orchestrator` subagent with/iu,
    /(?:inside|through|to) (?:a |the )?`pan-orchestrator` subagent/iu,
    /you relay between the operator and that subagent/iu,
  ]

  for (const documentationPath of ['README.md', ...markdownFiles('docs')]) {
    const body = repoText(documentationPath)

    for (const pattern of relayPatterns) {
      assert.ok(
        !pattern.test(body),
        `${documentationPath} contains forbidden supervisor relay wording: ${String(pattern)}`,
      )
    }
  }
})

function cardText(root: string, markdownPath: string): string {
  return readFileSync(path.join(root, markdownPath), 'utf8')
}

/**
 * The supervisor delegates from the continuation loop, where it holds no card
 * of its own. These assertions pin the delivery contract to the sibling
 * supervisor procedure document the card names, so compliance never depends
 * on recalling `AGENTS.md` — while the worker-visible card itself carries no
 * workflow lifecycle command. Delivery plan is the first delegated stage, so
 * the run has no supervisor-owned stage to fall back on.
 */
test('worker invocation cards point at the supervisor delivery procedure', () => {
  const root = createFixture()
  const invocationPolicy = loadPolicyCatalog(root).get('INVOCATION-001')

  assert.ok(invocationPolicy)

  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Delegation contract run',
  }).run_id

  // Plan is the first delegated worker stage, so the contract must already
  // hold on the very first card the supervisor delivers.
  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation
  const delegation = invocation?.delegation

  assert.ok(invocation)
  assert.equal(invocation.stage.slug, 'plan')
  assert.equal(invocation.stage.persona, 'planner')
  assert.ok(delegation)
  assert.equal(delegation.cursor_agent_path, '.cursor/agents/pan-planner.md')

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

  // The whole policy, not a pointer to it.
  for (const instruction of invocationPolicy.instructions) {
    assert.ok(
      procedure.includes(instruction),
      `procedure MUST inline INVOCATION-001 instruction: ${instruction}`,
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
