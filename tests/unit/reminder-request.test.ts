import assert from 'node:assert/strict'
import { cpSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { canonicalReminder } from '../../src/lib/governance/prompt-context/canonical.js'
import { ReminderRequestAssembler } from '../../src/lib/governance/prompt-context/request.js'
import { isRecord, readText, sha256 } from '../../src/lib/io.js'
import { createTestTempDirectory } from '../temp.js'

const OPTIONS = {
  host: 'vscode',
  provider: 'openai',
  session: 'request-session',
  role: 'pair',
}

function fixture(): string {
  const root = createTestTempDirectory('reminder-request-')

  for (const name of ['AGENTS.md', 'config.json', 'governance', 'library']) {
    cpSync(path.join(process.cwd(), name), path.join(root, name), {
      recursive: true,
    })
  }

  return root
}

function request() {
  return {
    model: 'synthetic-openai-model',
    instructions: 'Existing provider instructions.',
    input: [{ role: 'user', content: 'Synthetic question.' }],
    tools: [{ type: 'function', name: 'read_fixture', parameters: {} }],
    store: false,
    truncation: 'disabled',
  }
}

test('happy_path: synthetic request smoke keeps one full body and one cue across tool continuations', () => {
  const root = fixture()
  const assembler = new ReminderRequestAssembler(root, OPTIONS)
  const original = request()
  const before = structuredClone(original)
  const first = assembler.assemble(original)
  const reminder = canonicalReminder(root, OPTIONS)

  assert.equal(first.event.delivery, 'full')
  assert.equal(first.event.reason, 'session_start')
  assert.ok(first.request.instructions.includes(reminder.content))
  assert.ok(first.request.instructions.includes(reminder.deferred_content))
  assert.ok(first.request.instructions.startsWith(original.instructions))
  assert.deepEqual(original, before)

  const continuation = {
    ...first.request,
    input: [
      ...original.input,
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'Synthetic output.',
      },
    ],
  }
  const second = assembler.assemble(continuation)
  const third = assembler.assemble(second.request)

  assert.equal(second.event.delivery, 'cue')
  assert.equal(second.event.reason, 'verified_presence')
  assert.ok(second.event.appended_bytes < first.event.appended_bytes)
  assert.equal(third.event.appended_bytes, 0)
  assert.equal(third.request.instructions, second.request.instructions)
  assert.equal(third.request.instructions.split(reminder.content).length - 1, 1)
  assert.equal(
    third.request.instructions.split('Apply the full Pancreator reminder')
      .length - 1,
    1,
  )
  assert.deepEqual(third.request.input, continuation.input)
  assert.deepEqual(third.request.tools, original.tools)
  assert.equal(third.request.store, false)
  assert.equal(third.request.model, original.model)
  assert.deepEqual(JSON.parse(JSON.stringify(third.request)), third.request)

  const audit = readText(first.audit_path)
  assert.deepEqual(
    audit
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
    [first.event, second.event, third.event],
  )
  assert.equal(
    first.event.instructions_sha256,
    sha256(first.request.instructions),
  )
  assert.equal(audit.includes(original.input[0]!.content), false)
  assert.equal(audit.includes(reminder.content), false)
})

test('critical_unhappy_path: compaction, cue-only context, and damaged bodies always restore the full reminder', () => {
  const root = fixture()
  const assembler = new ReminderRequestAssembler(root, OPTIONS)
  const first = assembler.assemble(request())
  const second = assembler.assemble(first.request)
  const cueOnly = second.request.instructions.slice(
    first.request.instructions.length,
  )
  const reminder = canonicalReminder(root, OPTIONS)

  for (const [instructions, reason] of [
    ['', 'missing_presence'],
    [cueOnly, 'missing_presence'],
    [
      first.request.instructions.replace(
        reminder.content,
        'Compacted summary.',
      ),
      'stale_presence',
    ],
  ]) {
    const recovered = assembler.assemble({ ...request(), instructions })

    assert.equal(recovered.event.delivery, 'full')
    assert.equal(recovered.event.reason, reason)
    assert.ok(recovered.request.instructions.includes(reminder.content))
    assert.ok(
      recovered.request.instructions.includes(reminder.deferred_content),
    )
  }
})

test('hidden_edge_case: history, tool results, cache identifiers, and old delivery logs do not prove presence', () => {
  const root = fixture()
  const assembler = new ReminderRequestAssembler(root, OPTIONS)
  const first = assembler.assemble(request())
  const replay = {
    ...request(),
    previous_response_id: 'old-response-with-reminder',
    prompt_cache_key: first.event.identity,
    input: [
      { role: 'user', content: first.request.instructions },
      {
        type: 'function_call_output',
        call_id: 'call-2',
        output: first.request.instructions,
      },
    ],
  }
  const recovered = assembler.assemble(replay)

  assert.equal(recovered.event.reason, 'missing_presence')
  assert.equal(recovered.event.delivery, 'full')
  assert.ok(readText(first.audit_path).includes(first.event.identity))
  assert.deepEqual(recovered.request.input, replay.input)
})

test('probable_edge_case: policy changes invalidate presence even outside the selected reminder lines', () => {
  const root = fixture()
  const assembler = new ReminderRequestAssembler(root, OPTIONS)
  const first = assembler.assemble(request())
  const policyPath = path.join(root, 'governance/policies/BROWSER-001.json')
  const policy: unknown = JSON.parse(readText(policyPath))
  assert.ok(isRecord(policy))
  assert.equal(typeof policy.summary, 'string')
  policy.summary = `${policy.summary} Synthetic policy change.`
  writeFileSync(policyPath, JSON.stringify(policy))

  const changed = assembler.assemble(first.request)

  assert.equal(changed.event.delivery, 'full')
  assert.equal(changed.event.reason, 'identity_changed')
  assert.equal(changed.event.identity_changed, true)
  assert.equal(changed.event.previous_identity, first.event.identity)
  assert.notEqual(changed.event.identity, first.event.identity)
  assert.equal(assembler.assemble(changed.request).event.delivery, 'cue')
})

test('probable_edge_case: child, resumed, and changed-role assemblers have independent delivery scopes', () => {
  const root = fixture()
  const parent = new ReminderRequestAssembler(root, OPTIONS)
  const first = parent.assemble(request())

  for (const options of [
    { ...OPTIONS, session: 'child-session' },
    OPTIONS,
    { ...OPTIONS, role: 'unbound' },
  ]) {
    const fresh = new ReminderRequestAssembler(root, options)
    const result = fresh.assemble(first.request)

    assert.equal(result.event.reason, 'session_start')
    assert.equal(result.event.delivery, 'full')
    assert.notEqual(result.event.assembly_id, first.event.assembly_id)
    assert.notEqual(result.audit_path, first.audit_path)
    assert.equal(fresh.assemble(result.request).event.delivery, 'cue')
  }

  assert.equal(parent.assemble(first.request).event.delivery, 'cue')
})

test('probable_edge_case: full mode reversibly bypasses suppression', () => {
  const assembler = new ReminderRequestAssembler(fixture(), OPTIONS)
  const first = assembler.assemble(request())
  const forced = assembler.assemble(first.request, { mode: 'full' })

  assert.equal(forced.event.delivery, 'full')
  assert.equal(forced.event.reason, 'forced_full')
  assert.ok(forced.event.appended_bytes > 0)
  assert.equal(assembler.assemble(forced.request).event.delivery, 'cue')
})

test('critical_unhappy_path: invalid requests, unsupported providers, and unavailable contracts fail before assembly', () => {
  const root = fixture()
  const assembler = new ReminderRequestAssembler(root, OPTIONS)

  for (const value of [
    null,
    [],
    { instructions: {} },
    { instructions: 42 },
    { truncation: 'auto' },
  ]) {
    assert.throws(() => assembler.assemble(value), {
      code: 'INVALID_REMINDER_REQUEST',
    })
  }

  assert.throws(
    () =>
      new ReminderRequestAssembler(root, {
        ...OPTIONS,
        provider: 'other',
      }).assemble(request()),
    { code: 'INVALID_CANONICAL_REMINDER' },
  )
  assert.throws(() =>
    new ReminderRequestAssembler(root, {
      ...OPTIONS,
      card: '../AGENTS.md',
    }).assemble(request()),
  )
  assert.throws(
    () =>
      new ReminderRequestAssembler(root, {
        ...OPTIONS,
        card: 'missing-card.md',
      }).assemble(request()),
    { code: 'READ_FAILED' },
  )
  assert.equal(
    assembler.assemble({ instructions: null }).event.delivery,
    'full',
  )
})

test('critical_unhappy_path: failed audit persistence returns no request and advances no delivery state', () => {
  const root = fixture()
  const logs = path.join(root, 'runtime/logs')
  mkdirSync(logs, { recursive: true })
  writeFileSync(path.join(logs, 'reminders'), 'Cannot create a directory here.')
  const assembler = new ReminderRequestAssembler(root, OPTIONS)

  assert.throws(() => assembler.assemble(request()))
  renameSync(path.join(logs, 'reminders'), path.join(logs, 'blocked-reminders'))
  const recovered = assembler.assemble(request())

  assert.equal(recovered.event.reason, 'session_start')
  assert.equal(recovered.event.previous_identity, null)
})
