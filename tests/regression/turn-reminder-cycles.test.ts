import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePromptContext } from '../../src/lib/governance/prompt-context.js'
import { readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { createFixture } from '../fixture-template.js'

const TOOL_EVENTS = [
  'postToolUse',
  'PostToolUse',
  'postToolUseFailure',
  'PostToolUseFailure',
]

const LEGACY_ROLE_CACHE = '.cursor/hooks/state/conversations.json'

test('happy_path: legacy conversation roles migrate to runtime without overwriting the old cache', () => {
  const root = createFixture()
  const legacy = path.join(root, LEGACY_ROLE_CACHE)
  const canonical = path.join(root, 'runtime/reminders/conversations.json')
  rmSync(canonical, { force: true })

  const now = new Date('2026-11-11T13:00:00.000Z')
  const legacyData = {
    schema_version: 1,
    conversations: {
      legacy: { role: 'pair', mode: 'pair', updated_at: now.toISOString() },
    },
  }
  writeJsonAtomic(legacy, legacyData)
  const original = readFileSync(legacy, 'utf8')
  const payload = JSON.stringify({
    conversation_id: 'legacy',
    hook_event_name: 'PostToolUse',
  })
  const response = resolvePromptContext(root, payload, now)

  assert.match(response.additional_context ?? '', /^Role: pair$/mu)
  assert.deepEqual(readJson(canonical), legacyData)
  assert.equal(readFileSync(legacy, 'utf8'), original)

  writeJsonAtomic(legacy, { schema_version: 1, conversations: {} })
  assert.match(
    resolvePromptContext(root, payload, now).additional_context ?? '',
    /^Role: pair$/mu,
  )
})

test('critical_unhappy_path: a blocked legacy cache destination cannot suppress recurring reminders', () => {
  const root = createFixture()
  const legacy = path.join(root, LEGACY_ROLE_CACHE)
  rmSync(legacy, { recursive: true, force: true })
  mkdirSync(legacy, { recursive: true })

  const conversation_id = 'runtime-only-reminder'
  const response = resolvePromptContext(
    root,
    JSON.stringify({
      conversation_id,
      hook_event_name: 'beforeSubmitPrompt',
      prompt: '/pan-pair',
    }),
  )
  assert.match(response.additional_context ?? '', /^Role: pair$/mu)
  assert.equal(lstatSync(legacy).isDirectory(), true)
  assert.ok(readJson(path.join(root, 'runtime/reminders/conversations.json')))

  for (const hook_event_name of TOOL_EVENTS) {
    const repeated = resolvePromptContext(
      root,
      JSON.stringify({ conversation_id, hook_event_name }),
    )
    assert.deepEqual(repeated, response)
  }
})

test('tool cycles reissue the full governance reminder without transcript evidence', () => {
  const root = createFixture()
  const conversation_id = 'reminder-cycles'
  const initial = resolvePromptContext(
    root,
    JSON.stringify({
      conversation_id,
      hook_event_name: 'beforeSubmitPrompt',
      prompt: '/pan-pair',
    }),
  )

  assert.match(initial.additional_context ?? '', /^Role: pair$/mu)
  assert.match(initial.additional_context ?? '', /^\[COMMS-001\]$/mu)
  assert.match(initial.additional_context ?? '', /^\[MOMENTUM-001\]$/mu)
  assert.match(
    initial.additional_context ?? '',
    /^Remember the operating principles; you MUST abide by these:$/mu,
  )

  for (const hook_event_name of TOOL_EVENTS) {
    for (const transcript_path of [undefined, '/missing/transcript.jsonl']) {
      const response = resolvePromptContext(
        root,
        JSON.stringify({
          conversation_id,
          hook_event_name,
          transcript_path,
          prompt: '/pan-status',
        }),
      )

      assert.deepEqual(response, initial, hook_event_name)
    }
  }

  const fresh = resolvePromptContext(
    root,
    JSON.stringify({
      conversation_id: 'new-tool-session',
      hook_event_name: 'postToolUse',
    }),
  )

  assert.match(fresh.additional_context ?? '', /^Role: unbound$/mu)
  assert.match(fresh.additional_context ?? '', /^\[COMMS-001\]$/mu)
  assert.match(
    fresh.additional_context ?? '',
    /Remember the operating principles;/u,
  )
})

test('host hook templates deliver governance reminders on every tool cycle', () => {
  const cases = [
    {
      file: 'library/cursor/hooks.json',
      commandKey: 'command',
      events: ['beforeSubmitPrompt', 'postToolUse', 'postToolUseFailure'],
    },
    {
      file: 'library/vscode/hooks.json',
      commandKey: 'bash',
      events: ['userPromptSubmitted', 'sessionStart', 'postToolUse'],
    },
  ]

  for (const { file, commandKey, events } of cases) {
    const hooks = (
      JSON.parse(readFileSync(path.join(process.cwd(), file), 'utf8')) as {
        hooks: Record<string, Array<Record<string, unknown>>>
      }
    ).hooks

    for (const event of events) {
      const reminders = (hooks[event] ?? []).filter((entry) =>
        String(entry[commandKey]).includes('pan-hook-governance-reminder'),
      )

      assert.equal(reminders.length, 1, `${file}: ${event}`)

      if (event.startsWith('postToolUse')) {
        assert.equal(reminders[0]?.matcher ?? '.*', '.*')
      }
    }
  }
})
