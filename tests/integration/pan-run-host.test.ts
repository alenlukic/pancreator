/**
 * `bin/pan-run` records the host and the host's session id beside the
 * Cursor conversation id it keeps for compatibility.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const PAN_RUN = path.join(process.cwd(), 'bin', 'pan-run')

function recordFor(
  root: string,
  env: NodeJS.ProcessEnv,
): Record<string, unknown> {
  const result = spawnSync(PAN_RUN, ['--', 'true'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CURSOR_CONVERSATION_ID: '',
      PAN_HOST: '',
      PAN_HOST_SESSION_ID: '',
      COPILOT_AGENT_SESSION_ID: '',
      ...env,
      PANCREATOR_ROOT: root,
    },
    timeout: 30_000,
  })
  assert.equal(result.status, 0, result.stderr)

  const shellDir = path.join(root, 'runtime', 'logs', 'shell')
  const latest = readlinkSync(path.join(shellDir, 'latest'))

  return JSON.parse(
    readFileSync(path.join(shellDir, latest, 'record.json'), 'utf8'),
  ) as Record<string, unknown>
}

test('pan-run records the host and its session id', async (t) => {
  const root = createTestTempDirectory('pan-run-host-')
  const fields = (record: Record<string, unknown>): unknown[] => [
    record.cursor_conversation_id,
    record.host,
    record.host_session_id,
  ]

  await t.test('a Cursor conversation names host cursor', () => {
    assert.deepEqual(
      fields(recordFor(root, { CURSOR_CONVERSATION_ID: 'agent-1' })),
      ['agent-1', 'cursor', 'agent-1'],
    )
  })

  await t.test('another host names itself through PAN_HOST', () => {
    assert.deepEqual(
      fields(
        recordFor(root, {
          PAN_HOST: 'copilot-cli',
          PAN_HOST_SESSION_ID: 'sess-7',
        }),
      ),
      [null, 'copilot-cli', 'sess-7'],
    )
  })

  await t.test('the Copilot runtime session id names host copilot-cli', () => {
    assert.deepEqual(
      fields(recordFor(root, { COPILOT_AGENT_SESSION_ID: 'copilot-1' })),
      [null, 'copilot-cli', 'copilot-1'],
    )
  })

  await t.test(
    'PAN_HOST and PAN_HOST_SESSION_ID win over the Copilot id',
    () => {
      assert.deepEqual(
        fields(
          recordFor(root, {
            PAN_HOST: 'vscode',
            PAN_HOST_SESSION_ID: 'sess-8',
            COPILOT_AGENT_SESSION_ID: 'copilot-2',
          }),
        ),
        [null, 'vscode', 'sess-8'],
      )
      assert.deepEqual(
        fields(
          recordFor(root, {
            PAN_HOST: 'vscode',
            COPILOT_AGENT_SESSION_ID: 'copilot-3',
          }),
        ),
        [null, 'vscode', 'copilot-3'],
      )
    },
  )

  await t.test('an unknown host and a malformed session id record null', () => {
    assert.deepEqual(
      fields(
        recordFor(root, { PAN_HOST: 'emacs', PAN_HOST_SESSION_ID: 'bad id!' }),
      ),
      [null, null, null],
    )
  })

  await t.test('no host environment records null', () => {
    assert.deepEqual(fields(recordFor(root, {})), [null, null, null])
  })
})
