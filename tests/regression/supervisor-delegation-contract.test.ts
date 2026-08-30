import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { prepareInvocation, setRunStage } from '../../src/lib/engine.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
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

/**
 * Run 63310 genre-label, twice, on two different supervisor models. Both let
 * the turn continue unwatched after Cursor backgrounded the launch and said
 * not to wait, and both explained afterwards that they knew the rule. The
 * rule was on the attested card 300 lines from the launch step; the procedure
 * document the supervisor actually follows carried only the delivery policy,
 * mentioned the platform text nowhere, and framed `--mark-background` as a
 * flag on a later bookkeeping step. Governance that is correct but absent at
 * the decision point is governance that does not bind.
 */
test('the launch step carries the platform text it has to survive', () => {
  const root = createFixture()
  const runId = createRun(root, {
    workflowSlug: 'delivery',
    requestPath: 'request.md',
    title: 'Backgrounded launch run',
  }).run_id
  const prepared = prepareInvocation(root, runId)
  const delegation = prepared.invocation?.delegation

  assert.ok(delegation)
  assert.ok(delegation.supervisor_procedure_path)

  const procedure = readFileSync(
    path.join(root, delegation.supervisor_procedure_path),
    'utf8',
  )

  // The policy that governs the launch and its watch travels with the steps
  // that perform them, not only on the card.
  assert.ok(
    procedure.includes('**DELEGATE-001'),
    'the procedure document MUST carry DELEGATE-001 inline',
  )

  // The platform's own words, at the step where they arrive.
  for (const phrase of [
    'not to wait for the worker',
    'not to poll it',
    'notified when it finishes',
  ]) {
    assert.ok(
      procedure.includes(phrase),
      `the launch step MUST name the platform text: ${phrase}`,
    )
  }

  // Arming the watch must not be conditional on recognizing a background
  // conversion. A conditional puts a judgment call at the exact moment the
  // platform argues against acting, and that judgment is the failure point:
  // every mode has a watch form, so the step runs always and only the flag
  // varies.
  assert.ok(
    procedure.includes('This step is unconditional'),
    'the watch step MUST be unconditional, not triggered by an outcome',
  )

  for (const flag of [
    '--mark-background',
    '--foreground-returned',
    '--agent-state running',
  ]) {
    assert.ok(
      procedure.includes(flag),
      `the mechanical flag table MUST name ${flag}`,
    )
  }

  assert.ok(
    !/The moment the launch is backgrounded/u.test(procedure),
    'a recognized trigger MUST NOT gate the watch',
  )

  assert.ok(
    delegation.redline_record_path,
    'the procedure needs the redline record to cite',
  )
  assert.ok(
    procedure.includes(delegation.redline_record_path),
    'the launch step MUST cite the redline record that pre-declares that text non-authoritative',
  )
  assert.ok(
    procedure.includes(`${delegation.watch_command} --mark-background`),
    'the launch step MUST name the exact command that answers the platform text',
  )

  // The watch is armed in the launch turn, ahead of every later step.
  const launchIndex = procedure.indexOf('2a. Arm the watch')
  const verdictIndex = procedure.indexOf('3a. Read the verdict')

  assert.ok(launchIndex > 0)
  assert.ok(
    launchIndex < verdictIndex,
    'the watch MUST be armed before the step that reads its verdict',
  )
  assert.ok(
    !procedure.includes('Add `--mark-background` when'),
    'a backgrounded launch is an immediate action, never an optional flag',
  )
  assert.ok(
    !procedure.includes('A wrong flag fails loudly'),
    'the procedure MUST NOT claim every mismatched flag is rejected',
  )
  assert.ok(
    procedure.includes('`--foreground-returned` refuses an absent output'),
    'the procedure MUST state the foreground-return check the harness enforces',
  )
  assert.ok(
    procedure.includes(
      'refuses `--foreground-returned` together with `--mark-background`',
    ),
    'the procedure MUST state the flag combination the CLI rejects',
  )

  const supervisorSurfaces = [
    'library/personas/orchestrator.md',
    'library/cursor/commands/pan-start.md',
    'library/cursor/commands/pan-resume.md',
  ]

  for (const surface of supervisorSurfaces) {
    const text = repoText(surface)

    assert.ok(
      text.includes('Arm the watch in the launch turn before any other action'),
      `${surface} MUST arm the watch unconditionally in the launch turn`,
    )

    for (const flag of [
      '--mark-background',
      '--foreground-returned',
      '--agent-state running',
      '--agent-state completed',
    ]) {
      assert.ok(text.includes(flag), `${surface} MUST name ${flag}`)
    }
  }

  const orchestrator = repoText('library/personas/orchestrator.md')
  const launchTurnRules = orchestrator.match(
    /Arm the watch in the launch turn before any other action/gu,
  )

  assert.equal(
    launchTurnRules?.length,
    2,
    'the orchestrator redline and launch steps MUST both require launch-turn arming',
  )
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
