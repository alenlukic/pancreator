import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { renderPolicyCursorRule } from '../../src/lib/cursor-content.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'
import { policyInstructionAppliesToCard } from '../../src/lib/policy-instructions.js'
import { renderSupervisorProcedureMarkdown } from '../../src/lib/render.js'
import type { Invocation } from '../../src/lib/types.js'
import { CLI } from './watch-repair-helpers.js'

test('AC-014: policy lifetime', () => {
  const root = process.cwd()
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const agentText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'agent'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')
  const supervisorText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'supervisor'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')
  const guidance = `${agentText}\n${supervisorText}`

  // The full lifetime: the watch loops until a verdict or its bound.
  assert.match(
    guidance,
    /loops on the fixed cadence until a terminal verdict or its bound/u,
  )
  // The default bound is now one hour.
  assert.match(guidance, /one hour \(3600 seconds\)|one hour|3600/u)
  assert.doesNotMatch(guidance, /four hours/u)
  // The fixed cadence survives.
  assert.match(guidance, /60 seconds, fixed, and universal/u)
  // The misleading single-cycle prescription is gone; the prohibition that
  // replaced it stays.
  assert.doesNotMatch(guidance, /MUST be a background shell sleep/u)
  assert.doesNotMatch(guidance, /shell-await turn/u)
  assert.doesNotMatch(guidance, /one cadence per slice/u)
  assert.match(guidance, /MUST NOT hand-arm/u)
})

test('AC-015: platform await guidance', () => {
  const invocation = {
    invocation_id: 'implement-1-fixture',
    run_id: 'run-fixture',
    inputs: { references: [] },
    output: {
      path: 'runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
    },
    delegation: {
      persona: 'coder',
      cursor_agent_path: '.cursor/agents/pan-coder.md',
      canonical_markdown_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
      invocation_validation_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.invocation-validation.json',
      delegation_artifact_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delegation.md',
      supervisor_procedure_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.supervisor.md',
      submit_command:
        './bin/pan submit run-fixture runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
      mode: 'referenced',
      delivery_prompt_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delivery.md',
      watch_command:
        './bin/pan watch run-fixture --invocation implement-1-fixture',
      policies: [],
    },
  } as unknown as Invocation

  const procedure = renderSupervisorProcedureMarkdown(invocation)

  // The procedure prescribes a foreground blocking call and --attach on detach.
  assert.match(procedure, /foreground blocking/u)
  assert.match(procedure, /--attach/u)
  assert.doesNotMatch(procedure, /largest wait the platform supports/u)
  assert.doesNotMatch(procedure, /re-await the same command/u)
  // Never call AwaitShell.
  assert.match(procedure, /Never call .AwaitShell/u)
  // No mandate of one model await per cadence, and no duplicate watch.
  assert.doesNotMatch(procedure, /one cadence per slice/u)
  assert.match(procedure, /rather than arming a\s+second watch/u)
})

test('AC-017: projected lifetime', () => {
  const root = process.cwd()

  // The canonical supervisor procedure.
  const invocation = {
    invocation_id: 'implement-1-fixture',
    run_id: 'run-fixture',
    inputs: { references: [] },
    output: {
      path: 'runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
    },
    delegation: {
      persona: 'coder',
      cursor_agent_path: '.cursor/agents/pan-coder.md',
      canonical_markdown_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.md',
      invocation_validation_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.invocation-validation.json',
      delegation_artifact_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delegation.md',
      supervisor_procedure_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.supervisor.md',
      submit_command:
        './bin/pan submit run-fixture runtime/logs/workflows/run-fixture/outputs/implement-1-fixture.json',
      mode: 'referenced',
      delivery_prompt_path:
        'runtime/logs/workflows/run-fixture/invocations/implement-1-fixture.delivery.md',
      watch_command:
        './bin/pan watch run-fixture --invocation implement-1-fixture',
      policies: [],
    },
  } as unknown as Invocation
  const procedure = renderSupervisorProcedureMarkdown(invocation)

  // The orchestrator persona.
  const persona = readFileSync(
    path.join(root, 'library/personas/orchestrator.md'),
    'utf8',
  )

  // The CLI help.
  const help = spawnSync(process.execPath, [CLI, 'help'], {
    cwd: root,
    encoding: 'utf8',
  }).stdout

  for (const [surface, text] of [
    ['procedure', procedure],
    ['persona', persona],
    ['help', help],
  ] as const) {
    // Lifetime: the watch loops to a verdict or its bound — one hour now.
    assert.match(
      text,
      /one hour|3600/u,
      `${surface} MUST state the one-hour default bound`,
    )
    assert.doesNotMatch(
      text,
      /four hours|four-hour|14400/u,
      `${surface} MUST NOT contain the retired four-hour default`,
    )
    // The hold semantics survive on every surface.
    assert.match(
      text,
      /confirming wake/u,
      `${surface} MUST state the confirming-wake hold`,
    )
  }

  // The exception semantics: the policy and the CLI both name the authority.
  assert.match(help, /--cadence-directed-by-operator/u)
  assert.match(persona, /--agent-state-evidence/u)

  // A fresh projection of the policy matches the canonical source text.
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const projection = renderPolicyCursorRule(policy)

  for (const instruction of policy.instructions) {
    if (policyInstructionAppliesToCard(instruction, 'agent')) {
      const text =
        typeof instruction === 'string' ? instruction : instruction.text

      assert.ok(
        projection.includes(text),
        `the projection MUST carry: ${text.slice(0, 60)}...`,
      )
    }
  }
})

test('AC-021: cohort guidance', () => {
  const root = process.cwd()
  const persona = readFileSync(
    path.join(root, 'library/personas/orchestrator.md'),
    'utf8',
  )
  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const cohortInstruction = policy.instructions
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .find((text) => text.includes('--until-terminal'))

  // The terminal-only option is the documented cohort wait.
  assert.ok(cohortInstruction, 'the policy names the terminal-only option')
  assert.match(cohortInstruction ?? '', /sibling handoff/u)
  assert.match(cohortInstruction ?? '', /MUST rearm siblings promptly/u)
  assert.match(
    cohortInstruction ?? '',
    /without claiming continuous observation/u,
  )
  assert.match(persona, /--until-terminal/u)
  // Resume siblings promptly and reattach rather than duplicate.
  assert.match(persona, /promptly rearm the remainder/u)
  assert.match(persona, /Reattach to an existing watch/u)
  // No continuous-observation claim after a return.
  assert.match(persona, /Never claim continuous sibling observation/u)
})

test('AC-024: universal timer guidance', () => {
  const root = process.cwd()

  // Worker, supervisor, and standalone resolutions all carry the rule.
  for (const context of [
    { persona: 'coder', workflow: 'delivery', stage: 'implement' },
    { persona: 'orchestrator', workflow: 'delivery', stage: 'implement' },
    { persona: 'unbound', workflow: 'standalone', stage: 'unbound' },
  ] as const) {
    const resolved = resolvePolicies(root, context)

    assert.ok(
      resolved.some((policy) => policy.id === 'DELEGATE-001'),
      `${context.persona}/${context.workflow}/${context.stage} MUST resolve DELEGATE-001`,
    )
  }

  const policy = loadPolicyCatalog(root).get('DELEGATE-001')

  assert.ok(policy)

  const agentText = policy.instructions
    .filter((instruction) =>
      policyInstructionAppliesToCard(instruction, 'agent'),
    )
    .map((instruction) =>
      typeof instruction === 'string' ? instruction : instruction.text,
    )
    .join('\n')

  // `pan watch` is the exclusive timer, in and out of runs.
  assert.match(
    agentText,
    /MUST set every observation timer through `pan watch`/u,
  )
  assert.match(agentText, /The process form watches a process/u)
  // The old shell-sleep prescription is gone.
  assert.doesNotMatch(agentText, /background shell sleep/u)
  // AwaitShell is now explicitly banned in the policy.
  assert.match(agentText, /AwaitShell/u)
  assert.match(
    agentText,
    /AWAIT-SHELL-BAN-VALIDATE-001|banned|MUST NOT.*AwaitShell|AwaitShell.*banned/u,
  )
  // Platform awaits prescribe --attach, not reawait.
  assert.match(agentText, /--attach/u)
  assert.doesNotMatch(agentText, /MUST reawait the same watch command/u)
  // The opaque fallback is documented.
  assert.match(agentText, /timer form watches an opaque platform handle/u)

  // The projection carries the same text.
  const projection = renderPolicyCursorRule(policy)

  assert.match(
    projection,
    /MUST set every observation timer through `pan watch`/u,
  )
  assert.doesNotMatch(projection, /background shell sleep/u)
})
