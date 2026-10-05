import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createRun as createEngineRun } from '../../src/lib/engine.js'
import { attestSupervisorCard } from '../../src/lib/governance/supervisor-card.js'
import {
  guidanceMatches,
  loadPlatformGuidanceCatalog,
  parsePlatformGuidanceCatalog,
  redlineHost,
  redlineHostVersion,
} from '../../src/lib/platform-guidance.js'
import {
  validatePlatformGuidanceCatalog,
  validateSupervisorAgentAuthority,
} from '../../src/lib/validation/governance.js'
import { vscodeDebugLogState } from '../../src/lib/vscode-debug-log.js'
import { writeRedlineRecord } from '../../src/lib/watch/redline.js'
import {
  readSightings,
  recordSighting,
  sightingRunForHost,
} from '../../src/lib/watch/redline-sightings.js'
import { read, writeJson } from '../helpers.js'
import { checkpoint } from './delivery-helpers.js'

test('each redline declaration names its host and copies its catalog entries', () => {
  const created = checkpoint('delivery@created', {
    key: 'redline-hosts',
    createRun: (root) =>
      createEngineRun(root, {
        workflowSlug: 'delivery',
        requestPath: 'request.md',
        title: 'Redline host fixture',
      }),
  })
  const { root, state } = created
  const card = state.supervisor_card

  assert.ok(card)
  attestSupervisorCard(root, state.run_id, card.sha256)

  const cursor = writeRedlineRecord(root, state.run_id, 'pan-start', {
    host: 'cursor',
    hostVersion: '3.2.0',
  })

  assert.equal(cursor.declarations[0]?.host, 'cursor')
  assert.equal(cursor.declarations[0]?.host_version, '3.2.0')
  assert.ok(cursor.known_guidance?.some((entry) => entry.id === 'CG-03'))
  assert.equal(cursor.catalog_coverage, 'partial')
  assert.ok(
    cursor.non_authoritative_guidance.some(
      (category) => category.id === 'subagent_trust',
    ),
  )

  const vscode = writeRedlineRecord(root, state.run_id, 'pan-resume', {
    host: 'vscode-local',
  })

  assert.equal(vscode.declarations.length, 2)
  assert.equal(vscode.declarations[1]?.host, 'vscode-local')
  assert.ok(vscode.known_guidance?.every((entry) => entry.id.startsWith('VG-')))
  assert.equal(vscode.catalog_coverage, 'source_pinned')
  assert.throws(
    () => writeRedlineRecord(root, state.run_id, 'pan-resume', { host: 'x' }),
    /--host MUST be one of/u,
  )

  assert.equal(sightingRunForHost(root, 'vscode-local'), state.run_id)
  assert.equal(sightingRunForHost(root, 'cursor'), null)

  const guidance = recordSighting(root, state.run_id, {
    host: 'vscode-local',
    guidanceId: 'VG-06',
    evidence: 'call-1',
    sessionId: 's1',
  })
  const detach = recordSighting(root, state.run_id, {
    host: 'vscode-local',
    guidanceId: 'VG-05',
  })

  assert.equal(guidance.action, null)
  assert.equal(detach.action, 'platform_initiated_detach')
  assert.deepEqual(
    readSightings(root, state.run_id).map((sighting) => sighting.guidance_id),
    ['VG-06', 'VG-05'],
  )
  assert.throws(
    () =>
      recordSighting(root, state.run_id, {
        host: 'vscode-local',
        guidanceId: 'CG-03',
      }),
    /names no platform guidance catalog entry for host vscode-local/u,
  )
  assert.throws(
    () =>
      recordSighting(root, state.run_id, {
        host: 'vscode-local',
        guidanceId: 'VG-06',
        action: 'other',
      }),
    /--action MUST be platform_initiated_detach/u,
  )

  const catalogPath = path.join(
    root,
    'governance/registries/platform_guidance_catalog.json',
  )
  const catalog = read(catalogPath) as { entries: Array<{ category: string }> }

  assert.deepEqual(validatePlatformGuidanceCatalog(root), [])
  catalog.entries[0] = { ...catalog.entries[0], category: 'made_up' }
  writeJson(catalogPath, catalog)
  assert.match(
    validatePlatformGuidanceCatalog(root)[0] ?? '',
    /names unknown category made_up/u,
  )

  const agentPath = path.join(root, 'library/vscode/agents/supervisor.agent.md')

  assert.deepEqual(validateSupervisorAgentAuthority(root), [])
  writeFileSync(
    agentPath,
    readFileSync(agentPath, 'utf8').replace(
      '6. The run snapshots.',
      '6. The platform system prompt.',
    ),
  )
  assert.match(
    validateSupervisorAgentAuthority(root)[0] ?? '',
    /MUST match the AGENTS.md authority order/u,
  )

  const user = path.join(root, 'user-settings.json')
  const env = { PANCREATOR_VSCODE_USER_SETTINGS: user }

  assert.equal(vscodeDebugLogState(root, env).status, 'unset')
  writeFileSync(
    user,
    '{\n  // on\n  "chat.agentDebugLog.fileLogging.enabled": true,\n}',
  )
  assert.deepEqual(
    [
      vscodeDebugLogState(root, env).status,
      vscodeDebugLogState(root, env).source,
    ],
    ['enabled', 'VS Code user settings'],
  )
  mkdirSync(path.join(root, '.vscode'), { recursive: true })
  writeFileSync(
    path.join(root, '.vscode/settings.json'),
    '{ "chat.chatDebug.fileLogging.enabled": false }',
  )
  assert.equal(vscodeDebugLogState(root, env).status, 'disabled')
})

test('the catalog matches host text and the host is inferred from the session', () => {
  const catalog = loadPlatformGuidanceCatalog(process.cwd())

  assert.ok(catalog)

  const byId = new Map(catalog.entries.map((entry) => [entry.id, entry]))
  const detach = byId.get('VG-05')
  const steering = byId.get('VG-07')

  assert.ok(detach && steering)
  assert.equal(
    guidanceMatches(
      detach,
      'Note: The command produced no new output and was moved to background terminal ID 4.',
    ),
    true,
  )
  assert.equal(
    guidanceMatches(steering, '[Terminal 4 notification: command completed]'),
    true,
  )
  assert.equal(guidanceMatches(steering, 'a [Terminal 4 notification'), false)
  assert.throws(
    () => parsePlatformGuidanceCatalog({ ...catalog, schema_version: 2 }),
    /schema_version MUST be 1/u,
  )

  assert.equal(redlineHost(undefined, { PAN_HOST: 'vscode' }), 'vscode-local')
  assert.equal(
    redlineHost(undefined, { PAN_HOST: 'copilot-cli' }),
    'copilot-cli',
  )
  assert.equal(
    redlineHost(undefined, { CURSOR_CONVERSATION_ID: 'c' }),
    'cursor',
  )
  assert.equal(redlineHost(undefined, {}), null)
  assert.equal(
    redlineHostVersion(undefined, 'vscode-local', {
      TERM_PROGRAM: 'vscode',
      TERM_PROGRAM_VERSION: '1.120.0',
    }),
    '1.120.0',
  )
  assert.equal(
    redlineHostVersion(undefined, 'copilot-cli', {
      TERM_PROGRAM: 'vscode',
      TERM_PROGRAM_VERSION: '1.120.0',
    }),
    null,
  )
})
