import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { resolvePromptContext } from '../../src/lib/governance/prompt-context.js'
import { createFixture } from '../fixture-template.js'

const TOOL_EVENTS = [
  'postToolUse',
  'PostToolUse',
  'postToolUseFailure',
  'PostToolUseFailure',
]

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
  assert.match(initial.additional_context ?? '', /^\[PRINCIPLES-001\]$/mu)

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
