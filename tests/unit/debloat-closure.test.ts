import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  sessionPaths,
  verifyDebloat,
  type DebloatScanRecord,
} from '../../src/lib/debloat.js'
import {
  computeClosure,
  previewCandidate,
} from '../../src/lib/debloat/closure.js'
import { buildReferenceGraph } from '../../src/lib/debloat/graph.js'
import type { Facility } from '../../src/lib/debloat/inventory.js'
import { buildSymbolIndex } from '../../src/lib/debloat/symbols.js'
import { createTestTempDirectory } from '../temp.js'

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

test('closure records paths and symbols stranded by a removal', async () => {
  const root = createTestTempDirectory('debloat-closure')

  write(
    root,
    'src/target.ts',
    'export function stranded(): number { return 1 }\n',
  )
  write(
    root,
    'src/owner.ts',
    "import { stranded } from './target.js'\nexport const owned = stranded()\n",
  )
  mkdirSync(path.join(root, 'governance', 'policies'), { recursive: true })

  const owner: Facility = {
    id: 'policy:OWNER-001',
    category: 'policy',
    name: 'OWNER-001',
    path: 'src/owner.ts',
    owned_paths: ['src/owner.ts'],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
  const facilities = [owner]
  const graph = buildReferenceGraph(root, facilities)
  const symbolIndex = await buildSymbolIndex(root)
  const closure = computeClosure(facilities, graph, [owner.id], {
    sessionId: '20260920-000000-abcdef',
    symbolIndex,
  })

  assert.ok(
    closure.freed.some(
      (entry) =>
        entry.kind === 'symbol' &&
        entry.path === 'src/target.ts' &&
        entry.symbol === 'stranded' &&
        entry.stranded_by === 'src/owner.ts',
    ),
  )
  assert.ok(
    closure.freed.some(
      (entry) =>
        entry.kind === 'path' &&
        entry.path === 'src/target.ts' &&
        entry.stranded_by === 'src/owner.ts',
    ),
  )

  const preview = previewCandidate(facilities, graph, owner.id, {
    sessionId: '20260920-000000-abcdef',
    symbolIndex,
  })

  assert.deepEqual(preview.freed, closure.freed)
})

test('verification stays incomplete while a freed symbol survives', async () => {
  const root = createTestTempDirectory('debloat-freed-verification')

  write(
    root,
    'config.json',
    readFileSync(path.join(process.cwd(), 'config.json'), 'utf8'),
  )
  write(
    root,
    'src/target.ts',
    'export function stranded(): number { return 1 }\n',
  )
  write(
    root,
    'src/owner.ts',
    "import { stranded } from './target.js'\nexport const owned = stranded()\n",
  )
  mkdirSync(path.join(root, 'governance', 'policies'), { recursive: true })

  const owner: Facility = {
    id: 'policy:OWNER-001',
    category: 'policy',
    name: 'OWNER-001',
    path: 'src/owner.ts',
    owned_paths: ['src/owner.ts'],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
  const symbolIndex = await buildSymbolIndex(root)
  const closure = computeClosure(
    [owner],
    buildReferenceGraph(root, [owner]),
    [owner.id],
    {
      sessionId: '20260920-000000-abcdef',
      symbolIndex,
    },
  )
  const paths = sessionPaths(root, '20260920-000000-abcdef')
  const scan: DebloatScanRecord = {
    schema_version: 1,
    session_id: paths.sessionId,
    generated_at: '2026-09-20T00:00:00.000Z',
    window_days: 30,
    window_start: '2026-08-21T00:00:00.000Z',
    workspace: { path: '.', worktree: null },
    sources: {
      workflow_runs: 0,
      sessions: 0,
      command_invocations: 0,
      transcript_files: 0,
      operator_request_files: 0,
      transcripts_root: null,
      debloat_sessions_excluded: 0,
      agent_invocations: 0,
      agent_lookups: 0,
      incidental_mentions: 0,
      by_source: {},
      unread: [],
    },
    facilities: [owner],
    usage: [],
    candidates: [owner.id],
    candidate_assessments: [],
    previews: [],
    orphan_findings: [],
    protected_candidates: [],
  }

  mkdirSync(paths.directory, { recursive: true })
  writeFileSync(paths.candidates, `${JSON.stringify(scan, null, 2)}\n`)
  writeFileSync(paths.closure, `${JSON.stringify(closure, null, 2)}\n`)
  rmSync(path.join(root, 'src', 'owner.ts'))

  const verification = await verifyDebloat(root, paths.sessionId)

  assert.equal(verification.status, 'incomplete')
  assert.ok(verification.surviving_freed_count > 0)
  assert.equal(verification.surviving_path_count, 0)
})
