import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  resolvePlatformGuidanceHook,
  type SightingRequest,
} from '../../src/lib/governance/platform-guidance-hook.js'
import { scanVscodeDebugLog } from '../../src/lib/vscode-debug-log.js'
import { createTestTempDirectory } from '../temp.js'

const PAN = '/harness/bin/pan'

function hookOptions(sightings: SightingRequest[] = []) {
  return {
    pan: PAN,
    observe: (request: SightingRequest) => sightings.push(request),
  }
}

function shellRecord(
  root: string,
  name: string,
  record: Record<string, unknown>,
  stale = false,
): void {
  const directory = path.join(root, 'runtime/logs/shell', name)

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'record.json'),
    JSON.stringify({ label: 'npm', ended_at: null, ...record }),
  )
  writeFileSync(path.join(directory, 'heartbeat.json'), '{}')

  if (stale) {
    const old = new Date(Date.now() - 10 * 60_000)

    utimesSync(path.join(directory, 'heartbeat.json'), old, old)
  }
}

test('a VS Code detach note records a sighting and names the watch to run', () => {
  const sightings: SightingRequest[] = []
  const response = resolvePlatformGuidanceHook(
    'postToolUse',
    JSON.stringify({
      host: 'vscode',
      conversation_id: 'session-1',
      tool_use_id: 'call-7',
      tool_output: {
        content: [
          '[pan-run] npm started pid=4; watch with ./bin/pan watch --shell runtime/logs/shell/20261005T0000Z-npm-ab12',
          'Note: The command produced no new output and was moved to background terminal ID 3.',
        ],
      },
    }),
    process.cwd(),
    hookOptions(sightings),
  )

  assert.deepEqual(sightings, [
    {
      host: 'vscode-local',
      guidanceId: 'VG-05',
      evidence: 'call-7',
      sessionId: 'session-1',
    },
  ])
  assert.match(
    response.additional_context ?? '',
    /VG-05 \(platform_initiated_detach\)/u,
  )
  assert.ok(
    response.additional_context?.includes(
      `\`${PAN} watch --shell runtime/logs/shell/20261005T0000Z-npm-ab12\``,
    ),
  )

  const quiet = resolvePlatformGuidanceHook(
    'postToolUse',
    JSON.stringify({ host: 'vscode', tool_output: 'all tests passed' }),
    process.cwd(),
    hookOptions(sightings),
  )

  assert.deepEqual(quiet, {})
  assert.equal(sightings.length, 1)
})

test('the stop guard blocks the first stop while a session command still runs', () => {
  const root = createTestTempDirectory('pan-stop-guard-')
  const stop = (payload: Record<string, unknown>) =>
    resolvePlatformGuidanceHook(
      'stop',
      JSON.stringify({ host: 'vscode', loop_count: 0, ...payload }),
      root,
      hookOptions(),
    )

  assert.deepEqual(stop({ conversation_id: 's1' }), {})

  shellRecord(root, 'own', { host: 'vscode', host_session_id: 's1' })
  shellRecord(root, 'stale', { host: 'vscode', host_session_id: 's1' }, true)
  shellRecord(root, 'done', {
    host: 'vscode',
    host_session_id: 's1',
    ended_at: '2026-10-05T00:00:00Z',
  })

  const blocked = stop({ conversation_id: 's1' })

  assert.match(blocked.followup_message ?? '', /DELEGATE-001/u)
  assert.ok(
    blocked.followup_message?.includes(
      `${PAN} watch --shell runtime/logs/shell/own`,
    ),
  )
  assert.ok(!blocked.followup_message?.includes('stale'))
  assert.ok(!blocked.followup_message?.includes('/done'))
  assert.deepEqual(stop({ conversation_id: 's1', loop_count: 1 }), {})
  assert.deepEqual(
    resolvePlatformGuidanceHook(
      'stop',
      JSON.stringify({ host: 'cursor', loop_count: 0, conversation_id: 's1' }),
      root,
      hookOptions(),
    ),
    {},
  )

  const workspace = path.join(root, 'workspace')

  shellRecord(root, 'unnamed', { host: null, cwd: workspace })
  shellRecord(root, 'cursor', { host: 'cursor', cwd: workspace })
  shellRecord(root, 'worker', { host: 'copilot-cli', cwd: workspace })

  const fallback = stop({ conversation_id: 's2', workspace_roots: [workspace] })

  assert.ok(fallback.followup_message?.includes('runtime/logs/shell/unnamed'))
  assert.ok(!fallback.followup_message?.includes('runtime/logs/shell/cursor'))
  assert.ok(!fallback.followup_message?.includes('runtime/logs/shell/worker'))
  assert.ok(
    stop({
      host: 'copilot-cli',
      conversation_id: 's3',
      workspace_roots: [workspace],
    }).followup_message?.includes('runtime/logs/shell/worker'),
  )
})

test('the debug log scan reports catalog ids and files, never content', () => {
  const directory = createTestTempDirectory('pan-debug-log-')

  mkdirSync(path.join(directory, 'session-1'))
  writeFileSync(
    path.join(directory, 'session-1/main.jsonl'),
    [
      JSON.stringify({
        inputMessages: [{ content: 'was moved to background terminal ID 2' }],
      }),
      JSON.stringify({
        inputMessages: [
          { content: '[Terminal 2 notification: command completed]' },
        ],
      }),
      '{"truncated',
    ].join('\n'),
  )
  writeFileSync(path.join(directory, 'session-1/broken.json'), 'not json')

  const scan = scanVscodeDebugLog(process.cwd(), directory)

  assert.equal(scan.files_scanned, 2)
  assert.deepEqual(scan.unreadable_files, ['session-1/broken.json'])
  assert.deepEqual(
    scan.matches.map((match) => [match.guidance_id, match.occurrences]),
    [
      ['VG-05', 1],
      ['VG-07', 1],
    ],
  )
  assert.ok(!JSON.stringify(scan).includes('terminal ID 2'))
  assert.ok(scan.unmatchable_guidance.includes('VG-09'))
})
