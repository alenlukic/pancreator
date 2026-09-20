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
import type { FacilityUsage } from '../../src/lib/debloat/usage.js'
import { createTestTempDirectory } from '../temp.js'

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

function usageRecord(
  facilityId: string,
  overrides: Partial<FacilityUsage> = {},
): FacilityUsage {
  return {
    facility_id: facilityId,
    evidence_tier: 'none',
    last_used_at: null,
    execution_count: 0,
    direction_count: 0,
    incidental_mention_count: 0,
    depended_on_by: [],
    test_only_references: false,
    samples: [],
    ...overrides,
  }
}

/**
 * A command and the subcommand its name alone points at.
 *
 * This is the shape that produced the defect. `buildReferenceGraph` derives a
 * `command:pan-<name>` to `cli-subcommand:<name>` edge from the name, so
 * selecting the command strands the subcommand with nothing else in the tree
 * to block it.
 */
function nameDerivedPair(): { root: string; facilities: Facility[] } {
  const root = createTestTempDirectory('debloat-cascade-usage')

  mkdirSync(path.join(root, 'governance', 'policies'), { recursive: true })

  return {
    root,
    facilities: [
      {
        id: 'command:pan-widget',
        category: 'command',
        name: 'pan-widget',
        path: 'library/cursor/commands/pan-widget.md',
        owned_paths: ['library/cursor/commands/pan-widget.md'],
        selectable: true,
        node_kind: 'facility',
        protected: false,
      },
      {
        id: 'cli-subcommand:widget',
        category: 'cli-subcommand',
        name: 'widget',
        path: 'src/lib/pan-command-grammar.ts',
        owned_paths: [],
        selectable: false,
        node_kind: 'derived',
        protected: false,
      },
    ],
  }
}

test('usage evidence blocks a cascade the reference graph would allow', () => {
  const { root, facilities } = nameDerivedPair()
  const graph = buildReferenceGraph(root, facilities)

  for (const evidence of [
    usageRecord('cli-subcommand:widget', {
      evidence_tier: 'execution',
      execution_count: 417,
      last_used_at: '2026-09-20T13:53:33.000Z',
    }),
    usageRecord('cli-subcommand:widget', {
      evidence_tier: 'direction',
      direction_count: 44,
    }),
  ]) {
    const closure = computeClosure(facilities, graph, ['command:pan-widget'], {
      sessionId: '20260920-000000-abcdef',
      usage: [evidence],
    })

    assert.deepEqual(closure.cascaded, [])
    assert.deepEqual(closure.removed_facilities, ['command:pan-widget'])

    const retained = closure.retained_because.find(
      (entry) => entry.facility_id === 'cli-subcommand:widget',
    )

    assert.ok(retained)
    assert.match(retained.reason, /usage in the window/u)
    assert.match(
      retained.reason,
      new RegExp(
        `${evidence.execution_count} executions and ` +
          `${evidence.direction_count} directions`,
        'u',
      ),
    )
  }

  const preview = previewCandidate(facilities, graph, 'command:pan-widget', {
    sessionId: '20260920-000000-abcdef',
    usage: [
      usageRecord('cli-subcommand:widget', {
        evidence_tier: 'execution',
        execution_count: 417,
      }),
    ],
  })

  assert.deepEqual(preview.cascaded, [])
})

test('a facility with no usage evidence still cascades', () => {
  const { root, facilities } = nameDerivedPair()
  const graph = buildReferenceGraph(root, facilities)

  for (const usage of [
    undefined,
    [],
    // A counted mention is not a use, so it must not retain anything.
    [
      usageRecord('cli-subcommand:widget', {
        incidental_mention_count: 9,
      }),
    ],
    // Reachability is derived from the edge the cascade is following, so it
    // cannot be the thing that blocks the cascade.
    [
      usageRecord('cli-subcommand:widget', {
        evidence_tier: 'reachable',
        depended_on_by: ['command:pan-widget'],
      }),
    ],
  ]) {
    const closure = computeClosure(facilities, graph, ['command:pan-widget'], {
      sessionId: '20260920-000000-abcdef',
      ...(usage === undefined ? {} : { usage }),
    })

    assert.deepEqual(closure.cascaded, ['cli-subcommand:widget'])
    assert.deepEqual(closure.retained_because, [])
  }
})

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
