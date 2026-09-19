import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { getRunState } from '../../src/lib/engine.js'
import {
  checkpointHorizonSession,
  horizonStatus,
  initHorizonSession,
  latestHorizonHandoff,
  nextHorizonTask,
  startHorizonSession,
} from '../../src/lib/horizon.js'
import { createFixture, read, writeJson } from '../helpers.js'
import {
  withFakeEvaluator,
  withFakeEvaluatorAndArbiter,
} from './delivery-helpers.js'

const PROMPT = 'Return one result.'

function promptQueue(root: string): void {
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [{ id: 'one', title: 'One', kind: 'prompt', prompt: PROMPT }],
  })
}

test('preflight refuses before mutation without card-attestation authorization', () => {
  const root = createFixture()

  promptQueue(root)
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-refusal',
    involvement: 'long-horizon',
  })

  assert.throws(
    () =>
      startHorizonSession(root, 'preflight-refusal', {
        attestSupervisorCard: false,
      }),
    /requires --attest-supervisor-card/u,
  )
  const state = horizonStatus(root, 'preflight-refusal')
  assert.equal(state.status, 'created')
  assert.equal(state.preflight.away_mode_armed, false)
  assert.equal(state.preflight.card_attestation_authorized, false)
})

test('an authorized session runs a prompt task and records its outcome', () => {
  const root = createFixture()

  promptQueue(root)
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-prompt',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-prompt', {
    attestSupervisorCard: true,
  })

  const executed = withFakeEvaluator(root, { ok: true }, () =>
    nextHorizonTask(root, 'preflight-prompt'),
  )

  assert.equal(executed.prompt_result?.ok, true)
  assert.equal(executed.task?.status, 'succeeded')
  assert.equal(executed.task?.run_id, null)

  const requestPath = path.join(
    root,
    'runtime',
    'inbox',
    'queue',
    'horizon-preflight-prompt-one.md',
  )

  assert.equal(readFileSync(requestPath, 'utf8'), `${PROMPT}\n`)

  const artifact = read(
    path.join(root, executed.task?.result_path ?? 'missing'),
  ) as {
    task_id: string
    request_path: string
    card_path: string
    ok: boolean
    granted_roots: string[]
    tool_policy: {
      granted_roots: string[]
      scope_gate: string
    }
    scope_check: {
      passed: boolean
      enforcement: string
      observation: string
      unapproved_changes: string[]
    }
  }

  assert.equal(artifact.task_id, 'one')
  assert.equal(
    artifact.request_path,
    'runtime/inbox/queue/horizon-preflight-prompt-one.md',
  )
  assert.match(artifact.card_path, /prompt-tasks\/one\.card\.md$/u)
  assert.equal(artifact.ok, true)
  // A task that declares no workspace runs in its own session runtime
  // directory. The harness root was the earlier default, and an unattended
  // launch must not inherit the whole installation.
  assert.deepEqual(artifact.granted_roots, [
    path.join(root, 'runtime', 'logs', 'horizon', 'preflight-prompt'),
  ])
  assert.equal(artifact.granted_roots.includes(root), false)
  assert.deepEqual(artifact.tool_policy.granted_roots, artifact.granted_roots)
  assert.equal(artifact.tool_policy.scope_gate, 'scope.no_unapproved_changes')
  assert.equal(artifact.scope_check.passed, true)
  assert.deepEqual(artifact.scope_check.unapproved_changes, [])
  // The host decides which boundary ran; both record which one it was.
  assert.ok(
    ['sandbox-exec', 'none'].includes(artifact.scope_check.enforcement),
    artifact.scope_check.enforcement,
  )

  // AC-55: a session that reaches its terminal state names a harness action,
  // never an operator one.
  const final = horizonStatus(root, 'preflight-prompt')
  const handoff = latestHorizonHandoff(root, 'preflight-prompt') as {
    next_action: string
    last_task_id: string
  }

  assert.equal(final.status, 'succeeded')
  assert.equal(final.active_task_id, null)
  assert.equal(handoff.next_action, 'No eligible task remains.')
  assert.equal(handoff.last_task_id, 'one')
})

test('an explicit named prompt-task grant widens only the recorded roots', () => {
  const root = createFixture()
  const workspace = path.join(root, 'runtime', 'prompt-workspace')
  const namedGrant = path.join(root, 'runtime', 'prompt-grant')

  mkdirSync(workspace, { recursive: true })
  mkdirSync(namedGrant, { recursive: true })
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'named-grant',
        title: 'Named grant task',
        kind: 'prompt',
        prompt: PROMPT,
        workspace: 'runtime/prompt-workspace',
        grants: [{ name: 'fixture-output', path: 'runtime/prompt-grant' }],
      },
    ],
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-named-grant',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-named-grant', {
    attestSupervisorCard: true,
  })

  const executed = withFakeEvaluator(root, { ok: true }, () =>
    nextHorizonTask(root, 'preflight-named-grant'),
  )
  const artifact = read(
    path.join(root, executed.task?.result_path ?? 'missing'),
  ) as {
    granted_roots: string[]
    tool_policy: {
      named_grants: Array<{ name: string; path: string }>
    }
  }

  assert.deepEqual(artifact.granted_roots, [
    workspace,
    path.join(root, 'runtime', 'logs', 'horizon', 'preflight-named-grant'),
    namedGrant,
  ])
  assert.deepEqual(artifact.tool_policy.named_grants, [
    { name: 'fixture-output', path: namedGrant },
  ])
})

/**
 * A prompt-task session whose fake agent tries to write every path the test
 * names, then reports success. `enforced` selects the write boundary under
 * test: the operating-system enforcement, or the observation fallback an
 * operator reaches with `PANCREATOR_WRITE_SANDBOX=0`.
 */
function scopeSession(
  root: string,
  sessionId: string,
  writtenPaths: string[],
  options: { enforced: boolean },
): { result_path: string; status: string } {
  const workspace = path.join(root, 'runtime', 'prompt-workspace')
  const binary = path.join(root, 'fake-prompt-cursor-agent')

  mkdirSync(workspace, { recursive: true })
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'scope',
        title: 'Scope task',
        kind: 'prompt',
        prompt: PROMPT,
        workspace: 'runtime/prompt-workspace',
      },
    ],
  })
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      // The in-grant write is the positive control: an enforced boundary that
      // also blocked this would prove nothing about the roots it denies.
      `printf 'inside\n' > '${path.join(workspace, 'granted.md')}'`,
      ...writtenPaths.flatMap((relative) => [
        `mkdir -p "$(dirname '${path.join(root, relative)}')"`,
        `printf 'outside\n' > '${path.join(root, relative)}'`,
      ]),
      `printf '%s\n' '${JSON.stringify({ session_id: 'scope-session', result: 'done' })}'`,
      '',
    ].join('\n'),
  )
  chmodSync(binary, 0o755)

  initHorizonSession(root, 'runtime/queue.json', {
    sessionId,
    involvement: 'long-horizon',
  })
  startHorizonSession(root, sessionId, { attestSupervisorCard: true })

  const priorBinary = process.env.PANCREATOR_CURSOR_AGENT_BIN
  const priorSandbox = process.env.PANCREATOR_WRITE_SANDBOX

  process.env.PANCREATOR_CURSOR_AGENT_BIN = binary

  if (options.enforced) {
    delete process.env.PANCREATOR_WRITE_SANDBOX
  } else {
    process.env.PANCREATOR_WRITE_SANDBOX = '0'
  }

  try {
    const executed = nextHorizonTask(root, sessionId)

    return {
      result_path: executed.task?.result_path ?? 'missing',
      status: executed.task?.status ?? 'missing',
    }
  } finally {
    restoreEnv('PANCREATOR_CURSOR_AGENT_BIN', priorBinary)
    restoreEnv('PANCREATOR_WRITE_SANDBOX', priorSandbox)
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

interface ScopeArtifact {
  ok: boolean
  error: string | null
  granted_roots: string[]
  scope_check: {
    passed: boolean
    enforcement: string
    enforcement_reason: string
    observation: string
    attribution?: string
    skipped_classes?: string[]
    unapproved_changes: string[]
  }
}

// The scope check first read a Git snapshot, which saw nothing under an
// ignored tree and nothing at all without a repository. Its replacement
// observed the filesystem but excluded `worktrees` and `runtime/tmp`, so a
// write there still met a clean pass. The fallback now excludes no tree.
test('the observation fallback records every out-of-grant write', () => {
  const root = createFixture()
  const taken = [
    'UNAPPROVED.md',
    'runtime/taken.md',
    'runtime/tmp/taken.md',
    'worktrees/taken.md',
  ]
  const executed = scopeSession(root, 'preflight-observed', taken, {
    enforced: false,
  })
  const artifact = read(path.join(root, executed.result_path)) as ScopeArtifact

  assert.equal(executed.status, 'failed')
  assert.equal(artifact.ok, false)
  assert.match(artifact.error ?? '', /outside its granted roots/u)
  assert.equal(artifact.scope_check.passed, false)
  assert.equal(artifact.scope_check.enforcement, 'none')
  assert.match(
    artifact.scope_check.enforcement_reason,
    /PANCREATOR_WRITE_SANDBOX=0/u,
  )
  assert.equal(artifact.scope_check.observation, 'filesystem')
  assert.deepEqual(artifact.scope_check.unapproved_changes, [...taken].sort())
  // What the walk does not look at is named, so a clean pass states its own
  // limits instead of implying complete coverage.
  assert.deepEqual(artifact.scope_check.skipped_classes, [
    '.git',
    'protected-paths',
  ])
  assert.equal(artifact.scope_check.attribution, 'observation-window')
})

test('the observation fallback still records a write without a Git repository', () => {
  const root = createFixture()

  rmSync(path.join(root, '.git'), { recursive: true, force: true })

  const executed = scopeSession(root, 'preflight-no-git', ['TAKEN.md'], {
    enforced: false,
  })
  const artifact = read(path.join(root, executed.result_path)) as ScopeArtifact

  assert.equal(executed.status, 'failed')
  assert.deepEqual(artifact.scope_check.unapproved_changes, ['TAKEN.md'])
})

// Observation can only report a write after it happened, and it charges any
// concurrent writer under the root to this task. Enforcement removes both
// problems by denying the write.
test(
  'an enforced prompt task cannot write outside its granted roots',
  {
    skip:
      process.platform === 'darwin'
        ? false
        : 'Write enforcement uses macOS sandbox-exec.',
  },
  () => {
    const root = createFixture()
    const taken = [
      'UNAPPROVED.md',
      'runtime/taken.md',
      'runtime/tmp/taken.md',
      'worktrees/taken.md',
    ]
    const executed = scopeSession(root, 'preflight-enforced', taken, {
      enforced: true,
    })
    const artifact = read(
      path.join(root, executed.result_path),
    ) as ScopeArtifact

    for (const relative of taken) {
      assert.equal(
        existsSync(path.join(root, relative)),
        false,
        `${relative} must not exist`,
      )
    }

    // The granted write proves the boundary is a boundary rather than a blanket
    // denial that would have produced the same empty result.
    assert.equal(
      readFileSync(
        path.join(root, 'runtime', 'prompt-workspace', 'granted.md'),
        'utf8',
      ),
      'inside\n',
    )
    assert.equal(artifact.scope_check.enforcement, 'sandbox-exec')
    assert.equal(artifact.scope_check.enforcement_reason, '')
    assert.equal(artifact.scope_check.observation, 'prevented')
    assert.deepEqual(artifact.scope_check.unapproved_changes, [])
    // Nothing outside the grant changed, so no observation window is recorded
    // and none is needed.
    assert.equal(artifact.scope_check.attribution, undefined)
  },
)

test('a prompt task refuses the harness root as a declared workspace', () => {
  const root = createFixture()

  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'root-workspace',
        title: 'Root workspace task',
        kind: 'prompt',
        prompt: PROMPT,
        workspace: '.',
      },
    ],
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-root-workspace',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-root-workspace', {
    attestSupervisorCard: true,
  })

  assert.throws(
    () => nextHorizonTask(root, 'preflight-root-workspace'),
    /declares the harness root as its workspace.*grants/su,
  )
})

test('an authorized session attests its first invocation without stopping', () => {
  const root = createFixture()
  const request = path.posix.join('runtime', 'inbox', 'queue', 'armed.md')

  mkdirSync(path.dirname(path.join(root, request)), { recursive: true })
  writeFileSync(path.join(root, request), '# Armed task\n')
  writeJson(path.join(root, 'runtime', 'queue.json'), {
    tasks: [
      {
        id: 'armed',
        title: 'Armed task',
        kind: 'workflow',
        workflow: 'planning',
        request_path: request,
      },
    ],
  })
  initHorizonSession(root, 'runtime/queue.json', {
    sessionId: 'preflight-armed',
    involvement: 'long-horizon',
  })
  startHorizonSession(root, 'preflight-armed', {
    attestSupervisorCard: true,
  })

  const opened = nextHorizonTask(root, 'preflight-armed')
  const runId = opened.run?.run_id as string
  const card = opened.run?.supervisor_card

  assert.ok(card)
  assert.notEqual(card.attested_sha256, card.sha256)

  // The fixture has no worker, so the first delegation stops the run. The
  // arbiter names a hard block here so the run rests where the driver left
  // it; the prepared invocation below is this test's subject, not the stop.
  withFakeEvaluatorAndArbiter(
    root,
    { ok: true },
    {
      verdict: 'hard_block',
      hard_block: 'LH-H2',
      reasoning: 'The fixture declares no worker executor.',
    },
    () => checkpointHorizonSession(root, 'preflight-armed'),
  )

  // The authorization the preflight recorded is what lets the driver attest
  // the card, so the run reaches its first prepared invocation unattended.
  const driven = getRunState(root, runId)

  assert.equal(
    driven.supervisor_card?.attested_sha256,
    driven.supervisor_card?.sha256,
  )
  // Attestation on its own is not the contract. An unattested card stops the
  // driver before it prepares anything, so the prepared invocation is what
  // proves the run reached its first stage unattended.
  assert.ok(driven.current_invocation)
  assert.equal(driven.current_stage, 'plan')
})
