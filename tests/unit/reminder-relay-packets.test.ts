import assert from 'node:assert/strict'
import { cpSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { canonicalReminder } from '../../src/lib/governance/prompt-context/canonical.js'
import { ReminderRelayPackets } from '../../src/lib/governance/prompt-context/relay-packets.js'
import { readText } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const OPTIONS = {
  host: 'vscode',
  provider: 'openai',
  session: 'relay-parent',
  role: 'pair',
}

function fixture() {
  const root = createTestTempDirectory('reminder-relay-packets-')

  for (const name of ['AGENTS.md', 'config.json', 'governance', 'library']) {
    cpSync(path.join(process.cwd(), name), path.join(root, name), {
      recursive: true,
    })
  }

  const packets = new ReminderRelayPackets(root)
  const body = canonicalReminder(root, OPTIONS).content
  const full = packets.issue(OPTIONS, body)
  assert.notEqual(full, body)
  return { root, packets, body, full }
}

function messages(...texts: string[]) {
  return {
    model: 'synthetic-openai',
    messages: texts.map((content) => ({ role: 'developer', content })),
    tools: [{ name: 'synthetic_tool', schema: { description: 'Unchanged' } }],
    stream: true,
  }
}

test('happy_path: only registered exact copies in one request lane become cues', () => {
  const { packets, full, body } = fixture()
  const original = messages(`before\n${full}`, full, `${full}\nafter`)
  const result = packets.transform(original)
  const encoded = JSON.stringify(result.request)

  assert.equal(result.stats.full, 1)
  assert.equal(result.stats.cues, 2)
  assert.ok(result.stats.bytes_saved > body.length)
  assert.equal(encoded.split('kind=\\"full\\"').length - 1, 1)
  assert.deepEqual(result.request.tools, original.tools)
  assert.deepEqual(
    original,
    messages(`before\n${full}`, full, `${full}\nafter`),
  )
  assert.equal(packets.transform(original, 'full').stats.cues, 0)
  assert.equal(packets.transform(messages(body, body)).stats.cues, 0)
})

test('probable_edge_case: truncated frames preserve live text and adjacent session packets', () => {
  const { root, packets, body, full } = fixture()
  const childOptions = { ...OPTIONS, session: 'relay-child' }
  const child = packets.issue(
    childOptions,
    canonicalReminder(root, childOptions).content,
  )
  const headerEnd = full.indexOf('\n')

  const partial = full.slice(0, headerEnd + 32)
  const live = '\nLIVE SCOPE EVIDENCE\n'
  const original = messages(`before\n${partial}${live}${child}\nafter`)
  const result = packets.transform(original)
  assert.ok(Array.isArray(result.request.messages))
  const output = result.request.messages[0]?.content

  assert.equal(result.stats.full, 2)
  assert.equal(result.stats.recovered, 1)
  assert.equal(typeof output, 'string')
  assert.ok(output.includes(body))
  assert.ok(output.includes(`${partial.slice(headerEnd)}${live}`))
  assert.ok(output.includes(child))
  assert.ok(output.startsWith('before\n'))
  assert.ok(output.endsWith('\nafter'))
  assert.deepEqual(
    original,
    messages(`before\n${partial}${live}${child}\nafter`),
  )
})

test('critical_unhappy_path: missing, summarized, stale, or truncated presence restores text or fails visibly', () => {
  const { root, packets, full, body } = fixture()
  const reduced = packets.transform(messages(full, full))
  assert.ok(Array.isArray(reduced.request.messages))
  const cue = reduced.request.messages[1]
  assert.ok(cue && typeof cue.content === 'string')
  const recovered = packets.transform(messages(cue.content))
  assert.equal(recovered.stats.full, 1)
  assert.equal(recovered.stats.recovered, 1)
  assert.ok(
    JSON.stringify(recovered.request).includes(
      'Pancreator governance reminder',
    ),
  )

  const damaged = packets.transform(
    messages(full.replace(body, 'Compacted summary.')),
  )
  assert.equal(damaged.stats.recovered, 1)
  for (const cut of [
    full.indexOf('\n') + 1,
    Math.floor(full.length / 2),
    full.length - 20,
  ]) {
    const truncated = packets.transform(messages(full.slice(0, cut)))
    assert.equal(truncated.stats.recovered, 1)
    assert.deepEqual(truncated.request.messages, messages(full).messages)
  }
  for (const unknown of [cue.content, cue.content.slice(0, -20)]) {
    assert.throws(
      () => new ReminderRelayPackets(root).transform(messages(unknown)),
      { code: 'REMINDER_RECOVERY_REQUIRED' },
    )
  }
  assert.throws(
    () => packets.transform({ ...messages(full), truncation: 'auto' }),
    { code: 'INVALID_REMINDER_REQUEST' },
  )

  const agents = path.join(root, 'AGENTS.md')
  writeFileSync(
    agents,
    readText(agents).replace('Correctly accomplish', 'Reliably accomplish'),
  )
  const stale = packets.transform(messages(full, full))
  assert.equal(stale.stats.identity_changes, 1)
  assert.ok(JSON.stringify(stale.request).includes('Reliably accomplish'))

  const current = packets.issue(
    OPTIONS,
    canonicalReminder(root, OPTIONS).content,
  )
  const mixed = packets.transform(messages(full, current, full, current))
  assert.equal(mixed.stats.full, 1)
  assert.equal(mixed.stats.cues, 3)
  assert.equal(mixed.stats.identity_changes, 1)
  assert.equal(
    JSON.stringify(mixed.request).split('Reliably accomplish').length - 1,
    1,
  )
})

test('hidden_edge_case: child sessions, roles, and tool schemas cannot supply cross-scope presence', () => {
  const { root, packets, full, body } = fixture()
  const childOptions = { ...OPTIONS, session: 'relay-child' }
  const child = packets.issue(
    childOptions,
    canonicalReminder(root, childOptions).content,
  )
  const request = {
    input: [
      { role: 'developer', content: [{ type: 'input_text', text: full }] },
      { role: 'user', content: [{ type: 'input_text', text: full }] },
      { role: 'developer', content: [{ type: 'input_text', text: child }] },
      { type: 'function_call_output', call_id: 'one', output: full },
    ],
    tools: [{ description: full }],
    previous_response_id: 'receipt-is-not-presence',
  }
  const result = packets.transform(request)
  assert.equal(result.stats.full, 4)
  assert.equal(result.stats.cues, 0)
  const sourceText =
    'const marker = `<pancreator-reminder id="${packet.id}" kind="full">`'
  assert.deepEqual(
    packets.transform(messages(sourceText)).request,
    messages(sourceText),
  )
  const live = packets.issue(
    OPTIONS,
    `${body}\n\nLive state stays outside the packet.`,
  )
  const liveResult = packets.transform(messages(live, live))
  assert.equal(
    JSON.stringify(liveResult.request).split(
      'Live state stays outside the packet.',
    ).length - 1,
    2,
  )
  assert.equal(liveResult.stats.cues, 1)
  assert.deepEqual(result.request.tools, request.tools)
  assert.equal(
    result.request.previous_response_id,
    request.previous_response_id,
  )
  assert.equal(
    packets.issue(OPTIONS, 'A summary without a full reminder.'),
    'A summary without a full reminder.',
  )
  assert.equal(
    packets.issue(OPTIONS, `${body}${'x'.repeat(12_000)}`),
    `${body}${'x'.repeat(12_000)}`,
  )
})
