import assert from 'node:assert/strict'
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  resolvePromptContext,
  TURN_REMINDER_REGISTRY_PATH,
  TURN_REMINDER_STATE_PATH,
} from '../../src/lib/governance/prompt-context.js'
import { persist } from '../../src/lib/state.js'
import { createFixture } from '../fixture-template.js'
import { checkpoint, type CheckpointVariant } from './delivery-helpers.js'

const LONG_HORIZON: CheckpointVariant = {
  key: 'prompt-context-long-horizon',
  run: { involvement: 'long-horizon' },
}

function payload(
  conversationId: string,
  prompt: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    conversation_id: conversationId,
    hook_event_name: 'beforeSubmitPrompt',
    prompt,
    ...extra,
  })
}

function role(
  response: ReturnType<typeof resolvePromptContext>,
): string | null {
  return /^Role: (.+)$/mu.exec(response.additional_context ?? '')?.[1] ?? null
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
}

function writeJson(filePath: string, value: unknown): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/** Every regular file under `root`, mapped to its modification time. */
function fileTimes(root: string): Map<string, number> {
  const times = new Map<string, number>()
  const pending = ['']

  while (pending.length > 0) {
    const relative = pending.pop() ?? ''

    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = path.posix.join(relative, entry.name)

      if (entry.isSymbolicLink()) {
        continue
      }

      if (entry.isDirectory()) {
        pending.push(child)
        continue
      }

      times.set(child, lstatSync(path.join(root, child)).mtimeMs)
    }
  }

  return times
}

test('a supervisor command persists until every run is terminal', () => {
  const { root, state: run } = checkpoint('delivery@created')

  assert.equal(
    role(resolvePromptContext(root, payload('conversation', '/pan-start'))),
    'regular-supervisor',
  )
  assert.equal(
    role(resolvePromptContext(root, payload('conversation', 'next reply'))),
    'regular-supervisor',
  )

  run.status = 'succeeded'
  persist(root, run, 'prompt_context_fixture_terminal')

  assert.equal(
    role(resolvePromptContext(root, payload('conversation', 'final reply'))),
    'unbound',
  )
})

test('prose naming a pan command keeps the live supervisor role', () => {
  const { root } = checkpoint('delivery@created')

  assert.equal(
    role(resolvePromptContext(root, payload('conversation', '/pan-start'))),
    'regular-supervisor',
  )

  for (const prose of [
    'run pan watch 63287_Sep-22-0314_governance-t and report each wake',
    'the pan doctor output looks wrong',
    'please pan validate before you merge',
    'I will pan submit the stage now',
  ]) {
    assert.equal(
      role(resolvePromptContext(root, payload('conversation', prose))),
      'regular-supervisor',
      prose,
    )
  }
})

test('live run records distinguish cohort and long-horizon supervisors', () => {
  const { root: horizonRoot } = checkpoint('planning@created', LONG_HORIZON)

  assert.equal(
    role(
      resolvePromptContext(horizonRoot, payload('horizon', 'ordinary reply')),
    ),
    'long-horizon-supervisor',
  )

  const { root: cohortRoot, state: cohortRun } = checkpoint('delivery@created')

  cohortRun.cohort = {
    cohort_id: '63287_Sep-22-0001_fixture',
    cohort_index: 1,
    chunk: 'fixture',
  }
  persist(cohortRoot, cohortRun, 'prompt_context_fixture_cohort')

  assert.equal(
    role(resolvePromptContext(cohortRoot, payload('cohort', 'ordinary reply'))),
    'cohort-supervisor',
  )
})

test('conversation state is atomic, age bounded, and entry bounded', () => {
  const root = createFixture()
  const registryPath = path.join(root, TURN_REMINDER_REGISTRY_PATH)
  const registry = readJson(registryPath) as {
    state: { max_age_days: number; max_entries: number }
  }

  registry.state.max_age_days = 1
  registry.state.max_entries = 2
  writeJson(registryPath, registry)

  for (const [index, conversationId] of ['one', 'two', 'three'].entries()) {
    resolvePromptContext(
      root,
      payload(conversationId, '/pan-pair'),
      new Date(`2026-09-2${index + 1}T12:00:00.000Z`),
    )
  }

  const statePath = path.join(root, TURN_REMINDER_STATE_PATH)
  const stored = readJson(statePath) as {
    conversations: Record<string, unknown>
  }

  assert.deepEqual(Object.keys(stored.conversations), ['three', 'two'])

  stored.conversations.aged = {
    role: 'pair',
    mode: 'pair',
    updated_at: '2020-01-01T00:00:00.000Z',
  }
  writeJson(statePath, stored)
  resolvePromptContext(
    root,
    payload('four', '/pan-pair'),
    new Date('2026-09-24T12:00:00.000Z'),
  )

  const pruned = readJson(statePath) as {
    conversations: Record<string, unknown>
  }

  assert.deepEqual(Object.keys(pruned.conversations), ['four', 'three'])
  assert.deepEqual(readdirSync(path.dirname(statePath)), ['conversations.json'])
})

test('a malformed stored record is pruned instead of disabling reminders', () => {
  const root = createFixture()
  const statePath = path.join(root, TURN_REMINDER_STATE_PATH)

  mkdirSync(path.dirname(statePath), { recursive: true })
  writeJson(statePath, {
    schema_version: 1,
    conversations: {
      corrupt: { role: 'not-a-role' },
      kept: {
        role: 'pair',
        mode: 'pair',
        updated_at: '2026-09-22T12:00:00.000Z',
      },
    },
  })

  const response = resolvePromptContext(
    root,
    payload('kept', 'ordinary reply'),
    new Date('2026-09-22T13:00:00.000Z'),
  )

  assert.equal(role(response), 'pair')

  const stored = readJson(statePath) as {
    conversations: Record<string, unknown>
  }

  assert.deepEqual(Object.keys(stored.conversations), ['kept'])
})

test('an unparseable state file is discarded and rewritten', () => {
  const root = createFixture()
  const statePath = path.join(root, TURN_REMINDER_STATE_PATH)

  mkdirSync(path.dirname(statePath), { recursive: true })
  writeFileSync(statePath, 'conversations: none\n')

  const response = resolvePromptContext(
    root,
    payload('recovered', '/pan-pair'),
    new Date('2026-09-22T13:00:00.000Z'),
  )

  assert.equal(role(response), 'pair')

  const stored = readJson(statePath) as {
    conversations: Record<string, unknown>
  }

  assert.deepEqual(Object.keys(stored.conversations), ['recovered'])
})

test('resolving a prompt writes only the conversation state file', () => {
  const root = createFixture()
  const before = fileTimes(root)

  resolvePromptContext(root, payload('single-write', '/pan-pair'))

  const after = fileTimes(root)
  const written = [...after]
    .filter(([file, mtimeMs]) => before.get(file) !== mtimeMs)
    .map(([file]) => file)

  assert.deepEqual(written, [TURN_REMINDER_STATE_PATH])
})

test('malformed input and unreadable resolver state fail open', () => {
  const malformed = resolvePromptContext(createFixture(), '{')
  assert.deepEqual(malformed, { continue: true })

  const unknownFieldRoot = createFixture()
  const unknownField = resolvePromptContext(
    unknownFieldRoot,
    payload('unknown', 'ordinary request', { future_field: { value: true } }),
  )

  assert.equal(unknownField.continue, true)
  assert.equal(role(unknownField), 'unbound')

  const unreadableRoot = createFixture()
  const statePath = path.join(unreadableRoot, TURN_REMINDER_STATE_PATH)
  mkdirSync(path.dirname(statePath), { recursive: true })
  mkdirSync(statePath)

  assert.deepEqual(
    resolvePromptContext(
      unreadableRoot,
      payload('unreadable', 'ordinary request'),
    ),
    { continue: true },
  )

  const internalErrorRoot = createFixture()
  writeFileSync(
    path.join(internalErrorRoot, TURN_REMINDER_REGISTRY_PATH),
    '{ invalid\n',
  )

  assert.deepEqual(
    resolvePromptContext(
      internalErrorRoot,
      payload('internal', 'ordinary request'),
    ),
    { continue: true },
  )

  rmSync(statePath, { recursive: true })
})

test('excluded commands and non-prompt events carry no reminder', () => {
  const root = createFixture()

  for (const prompt of [
    '/pan-augment',
    '/pan-status',
    '/pan-summarize-context',
    '/pan-validate',
    '/pan-meta-orchestrator',
    '/pan-orchestrator',
  ]) {
    assert.deepEqual(resolvePromptContext(root, payload(prompt, prompt)), {
      continue: true,
    })
  }

  for (const prompt of ['/pan-review', '/pan-tune-harness']) {
    assert.equal(
      role(resolvePromptContext(root, payload(prompt, prompt))),
      'standalone-other',
      prompt,
    )
  }

  assert.deepEqual(
    resolvePromptContext(
      root,
      JSON.stringify({
        conversation_id: 'subagent',
        hook_event_name: 'subagentStart',
        prompt: '/pan-pair',
      }),
    ),
    { continue: true },
  )
})
