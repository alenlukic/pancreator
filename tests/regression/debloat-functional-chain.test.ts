import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'

import { computeClosure } from '../../src/lib/debloat/closure.js'
import { buildReferenceGraph } from '../../src/lib/debloat/graph.js'
import { collectFacilities } from '../../src/lib/debloat/inventory.js'
import { findOrphans, orphanFacilities } from '../../src/lib/debloat/orphans.js'
import {
  buildSymbolIndex,
  sourceSymbolFacilities,
} from '../../src/lib/debloat/symbols.js'
import { createTestTempDirectory } from '../temp.js'

const HISTORICAL_COMMIT = '768063d1'
const SUBPROCESS_TIMEOUT_MS = 60_000
const SESSION = '20260920-000000-abcdef'

/**
 * Paths the 6.30.0 handoff found stranded by the same fourteen ids.
 *
 * Each one must land under `remove` or `edit`, which is what C-17 asks for. A
 * `freed` entry is a weaker result: it reports that nothing references the
 * path any more without saying the removal reaches it.
 */
const HISTORICAL_SURVIVORS = [
  'governance/policies/WORK-001.json',
  'governance/registries/validation_registry.json',
  'src/cli.ts',
  'src/lib/operator-artifact-profiles.ts',
  'src/lib/requirements/handlers.ts',
  'src/lib/requirements/resolve.ts',
  'src/lib/requirements/types.ts',
  'src/lib/validation.ts',
  'src/lib/validators/stage-validators.ts',
]

const SELECTED = [
  'command:pan-debug',
  'mode:investigation',
  'persona:hypervisor',
  'persona:investigator',
  'persona:repo-technician',
  'policy:HYPERVISOR-001',
  'skill:hypervisor',
  'skill:manual-qa-cases',
  'skill:map-acceptance-criteria',
  'skill:modern-code-review',
  'skill:scope-control',
  'template:stage-artifact.example.md',
  'template:supervisor-assessment.example.json',
  'workflow:preflight',
]

test('the pre-6.30.0 removal exposes the complete stranded chain', async () => {
  const root = createTestTempDirectory('debloat-functional-chain')
  const archive = spawnSync('git', ['archive', HISTORICAL_COMMIT], {
    cwd: process.cwd(),
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    timeout: SUBPROCESS_TIMEOUT_MS,
  })

  assert.equal(
    archive.status,
    0,
    `historical commit ${HISTORICAL_COMMIT} must be reachable: ${archive.stderr.toString()}`,
  )

  const extract = spawnSync('tar', ['-x', '-C', root], {
    input: archive.stdout,
    encoding: null,
    maxBuffer: 64 * 1024 * 1024,
    timeout: SUBPROCESS_TIMEOUT_MS,
  })

  assert.equal(extract.status, 0, extract.stderr.toString())

  const base = collectFacilities(root)
  const symbols = await buildSymbolIndex(root)
  const orphans = findOrphans(symbols)

  const facilities = [
    ...base,
    ...sourceSymbolFacilities(base, symbols),
    ...orphanFacilities(orphans),
  ]
  const graph = buildReferenceGraph(root, facilities)
  const closure = computeClosure(facilities, graph, SELECTED, {
    sessionId: SESSION,
    symbolIndex: symbols,
  })

  // `freed` is deliberately excluded. Accepting it here is what let the
  // weakened guard pass while a survivor sat outside the removal manifest.
  const reached = new Set([
    ...closure.remove.map((entry) => entry.path),
    ...closure.edit.map((entry) => entry.path),
  ])
  const freedPaths = new Set(closure.freed.map((entry) => entry.path))

  for (const expected of HISTORICAL_SURVIVORS) {
    assert.ok(
      reached.has(expected),
      `${expected} is under remove or edit, not only freed (freed: ${freedPaths.has(expected)})`,
    )
  }

  assert.ok(
    closure.freed.every((entry) => entry.stranded_by.length > 0),
    'every freed entry names its stranding referrer',
  )
})

/**
 * The four reference kinds C-2 declares non-functional.
 *
 * Each one looks like a dependency to a text scan and holds a facility alive
 * that nothing uses. The historical tree proves the cascade reaches far
 * enough; this proves it is not stopped by references that mean nothing.
 */
test('a comment, an index, a run record, and a dedicated test do not retain', async () => {
  const root = createTestTempDirectory('debloat-nonfunctional-chain')
  const write = async (relative: string, content: string): Promise<void> => {
    const absolute = path.join(root, relative)

    await mkdir(path.dirname(absolute), { recursive: true })
    await writeFile(absolute, content, 'utf8')
  }

  await write('AGENTS.md', '# Card\n')
  await write(
    'governance/policies/STAPLE-001.json',
    `${JSON.stringify(
      {
        id: 'STAPLE-001',
        title: 'STAPLE-001',
        severity: 'hard',
        summary: 'STAPLE-001 summary.',
        instructions: ['Agents MUST follow STAPLE-001.'],
      },
      null,
      2,
    )}\n`,
  )
  await write('library/skills/widget-craft.md', '# Widget craft\n')
  await write('library/skills/shared.md', '# Shared technique\n')
  await write(
    'library/skills/index.md',
    '- [`widget-craft.md`](widget-craft.md)\n- [`shared.md`](shared.md)\n',
  )
  await write(
    'src/lib/notes.ts',
    [
      '// Superseded by the shared technique; see library/skills/widget-craft.md.',
      '/* library/skills/widget-craft.md used to be resolved here. */',
      'export const value = 1',
      '',
    ].join('\n'),
  )
  await write(
    'runtime/logs/workflows/past-run/agent/state.json',
    `${JSON.stringify({ guidance: 'library/skills/widget-craft.md' })}\n`,
  )
  await write(
    'tests/unit/widget-craft.test.ts',
    "export const covered = 'library/skills/widget-craft.md'\n",
  )

  const facilities = collectFacilities(root)
  const closure = computeClosure(
    facilities,
    buildReferenceGraph(root, facilities),
    ['skill:widget-craft'],
    { sessionId: SESSION },
  )
  const removed = new Set(closure.remove.map((entry) => entry.path))
  const edited = new Map(closure.edit.map((entry) => [entry.path, entry]))

  assert.ok(removed.has('library/skills/widget-craft.md'))

  // The comment and the run record produce no edge at all, so neither the
  // module nor the runtime tree appears anywhere in the manifest.
  for (const path of [
    'src/lib/notes.ts',
    'runtime/logs/workflows/past-run/agent/state.json',
  ]) {
    assert.equal(removed.has(path), false, `${path} is not removed`)
    assert.equal(edited.has(path), false, `${path} is not edited`)
  }

  // The index is registration, so it loses a row instead of the whole file.
  assert.equal(
    edited.get('library/skills/index.md')?.referrer_class,
    'registry',
  )
  assert.equal(removed.has('library/skills/index.md'), false)

  // A test whose every reference is removed leaves with them.
  assert.equal(
    closure.remove.find(
      (entry) => entry.path === 'tests/unit/widget-craft.test.ts',
    )?.kind,
    'dedicated_test',
  )
  assert.deepEqual(closure.retained_because, [])
})
