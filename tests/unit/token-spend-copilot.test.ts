import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { copilotSessionCount } from '../../src/lib/token-spend/attribution.js'
import type { RunStorage } from '../../src/lib/token-spend/model.js'
import { copilotSessionWarnings } from '../../src/lib/token-spend/report.js'
import { createTestTempDirectory } from '../temp.js'

test('copilot sessions in the window are counted and labeled host copilot', () => {
  const directory = path.join(
    createTestTempDirectory('spend-copilot-'),
    'invocations',
  )
  mkdirSync(directory, { recursive: true })
  const write = (name: string, executor: string, recordedAt: string): void => {
    writeFileSync(
      path.join(directory, `${name}.delegation-execution.json`),
      JSON.stringify({ executor, recorded_at: recordedAt }),
    )
  }
  write('inside', 'copilot', '2026-10-02T00:00:00.000Z')
  write('outside', 'copilot', '2026-09-01T00:00:00.000Z')
  write('claude', 'claude-code', '2026-10-02T00:00:00.000Z')
  writeFileSync(path.join(directory, 'inv-1.json'), '{}')

  const storage: RunStorage = {
    state: path.join(directory, '..', 'state.json'),
    events: path.join(directory, '..', 'events.jsonl'),
    invocation: (id) => path.join(directory, `${id}.json`),
  }
  const missing: RunStorage = {
    ...storage,
    invocation: (id) => path.join(directory, 'absent', `${id}.json`),
  }
  const count = copilotSessionCount(
    new Map([
      ['run-1', storage],
      ['run-2', missing],
    ]),
    Date.parse('2026-10-01T00:00:00.000Z'),
    Date.parse('2026-10-03T00:00:00.000Z'),
  )

  assert.equal(count, 1)
  assert.deepEqual(copilotSessionWarnings(0), [])
  assert.match(
    copilotSessionWarnings(count)[0] ?? '',
    /^Unattributed host copilot: 1 GitHub Copilot worker session ran/u,
  )
})
