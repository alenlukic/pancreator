import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  computeDebloatImpact,
  recordDebloatAdjudication,
  scanDebloat,
  selectDebloatFacilities,
  sessionPaths,
  verifyDebloat,
  type DebloatScanRecord,
} from '../../src/lib/debloat.js'
import { PanError } from '../../src/lib/errors.js'
import { readJson, readText } from '../../src/lib/io.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = new Date('2026-09-20T00:00:00.000Z')
const SESSION = '20260920-000000-abcdef'

function write(absolute: string, content: string): void {
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content, 'utf8')
}

/**
 * One workflow run whose invocation names a persona, a workflow, and a policy.
 *
 * `daysAgo` places the run inside or outside the window, which is the only
 * thing that decides whether its facilities count as used.
 */
function writeRun(
  root: string,
  runId: string,
  daysAgo: number,
  invocation: { workflow: string; persona: string; policies: string[] },
): void {
  const at = new Date(NOW.getTime() - daysAgo * DAY_MS).toISOString()
  const agent = path.join(root, 'runtime', 'logs', 'workflows', runId, 'agent')

  write(
    path.join(agent, 'state.json'),
    `${JSON.stringify({
      run_id: runId,
      workflow_slug: invocation.workflow,
      status: 'complete',
      created_at: at,
      updated_at: at,
    })}\n`,
  )
  write(
    path.join(agent, 'invocations', '01_stage.json'),
    `${JSON.stringify({
      invocation_id: '01_stage',
      run_id: runId,
      created_at: at,
      workflow: { slug: invocation.workflow },
      stage: { slug: 'implement', persona: invocation.persona },
      policies: invocation.policies.map((id) => ({ id })),
    })}\n`,
  )
}

/** A standalone session, which is the only runtime trace a mode leaves. */
function writeSession(root: string, name: string, mode: string): void {
  write(
    path.join(root, 'runtime', 'logs', 'sessions', name, `${mode}-card.md`),
    `# ${mode}\n`,
  )
}

function scanRecord(root: string): DebloatScanRecord {
  return readJson(sessionPaths(root, SESSION).candidates) as DebloatScanRecord
}

/**
 * A fixture with no transcript directory and a controlled runtime tree.
 *
 * Pointing the scan at an empty transcripts directory removes the operator's
 * real chat history from the result, so the assertions below depend only on
 * the records this test writes.
 */
function createScannedFixture(): { root: string; transcripts: string } {
  const root = createFixture()
  const transcripts = createTestTempDirectory('debloat-transcripts')

  rmSync(path.join(root, 'runtime', 'logs'), {
    recursive: true,
    force: true,
  })
  write(
    path.join(root, 'src', 'lib', 'governance-card.ts'),
    [
      'export const STANDALONE_MODES = {',
      '  spotfix: {',
      "    kind: 'spotfix',",
      "    persona: 'spotfixer',",
      "    workflow: 'standalone',",
      '  },',
      '}',
      '',
    ].join('\n'),
  )

  return { root, transcripts }
}

test('the scan separates recorded use from silence inside the window', async () => {
  const { root, transcripts } = createScannedFixture()

  writeRun(root, 'recent', 3, {
    workflow: 'delivery',
    persona: 'coder',
    policies: ['ENG-001'],
  })
  // Outside the window by a day, so nothing it names counts as used.
  writeRun(root, 'stale', 31, {
    workflow: 'design',
    persona: 'designer',
    policies: ['DESIGN-001'],
  })
  writeSession(root, '00001_Sep-18-0001_spotfix', 'spotfix')

  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })

  const record = scanRecord(root)
  const tier = (id: string): string | undefined =>
    record.usage.find((entry) => entry.facility_id === id)?.evidence_tier

  assert.equal(record.window_days, 30)
  assert.equal(tier('workflow:delivery'), 'execution', 'workflow execution')
  assert.equal(tier('persona:coder'), 'execution', 'persona execution')
  assert.equal(tier('policy:ENG-001'), 'execution', 'policy execution')
  assert.equal(tier('mode:spotfix'), 'execution', 'mode execution')
  assert.equal(
    record.facilities.some((entry) => entry.id === 'mode:debloat'),
    false,
    'a mode present only in the running build is not inventoried',
  )

  // The session names the mode its command resolves, which is the only
  // runtime trace a card-backed slash command leaves behind.
  assert.equal(
    tier('command:pan-spotfix'),
    'execution',
    'standalone command execution',
  )

  // The stale run sits one day outside the window, so nothing it names is
  // credited with use.
  assert.notEqual(tier('workflow:design'), 'execution')
  assert.notEqual(tier('persona:designer'), 'execution')

  // A handbook leaves no record of its own. It counts as live because an
  // executed policy binds it as guidance.
  assert.equal(tier('handbook:eng/engineering'), 'reachable')
  assert.equal(record.candidates.includes('handbook:eng/engineering'), false)
})

test('an explicit day count moves the window it reads', async () => {
  const { root, transcripts } = createScannedFixture()

  // The same run the default window excludes by a day.
  writeRun(root, 'stale', 31, {
    workflow: 'design',
    persona: 'designer',
    policies: ['DESIGN-001'],
  })

  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
    windowDays: 60,
  })

  const record = scanRecord(root)
  const tier = (id: string): string | undefined =>
    record.usage.find((entry) => entry.facility_id === id)?.evidence_tier

  assert.equal(record.window_days, 60)
  assert.equal(
    record.window_start,
    new Date(NOW.getTime() - 60 * DAY_MS).toISOString(),
  )
  assert.equal(tier('workflow:design'), 'execution')
  assert.equal(tier('persona:designer'), 'execution')
  assert.equal(record.candidates.includes('workflow:design'), false)
  assert.match(readText(sessionPaths(root, SESSION).report), /last 60 days/u)
})

test('a facility nothing names or references becomes a candidate', async () => {
  const { root, transcripts } = createScannedFixture()

  write(
    path.join(root, 'library', 'skills', 'orphan-technique.md'),
    '# Orphan technique\n\nNothing references this.\n',
  )

  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })

  const record = scanRecord(root)
  const report = readText(sessionPaths(root, SESSION).report)

  assert.ok(record.candidates.includes('skill:orphan-technique'))
  assert.match(report, /orphan-technique/u)

  // Every category block states what its silence is worth, and every row
  // states what selecting it would free. Both drive the operator's decision,
  // so neither may quietly disappear from the render.
  assert.match(
    report,
    /### skill \(\d+\)\n\nConfidence for this category is medium: recorded only when a policy binds it as guidance\./u,
  )
  assert.match(
    report,
    /\| Deterministic result \| Agentic adjudication \| Selection frees \|/u,
  )
  assert.match(
    report,
    /\| `skill:orphan-technique` \| `library\/skills\/orphan-technique\.md` \| no \| unclear \| required before selection \| nothing \|/u,
  )
  // A candidate whose removal would cascade states what it takes with it, so
  // the `nothing` above is a real reading rather than an empty column.
  assert.match(report, /\| unused \| not required \| [^|\n]*:[^|\n]* \|/u)

  // Coverage is stated rather than implied, so an unread evidence file is
  // visible instead of silently missing from the counts.
  assert.match(report, /^- unread: none$/mu)
})

test('a facility only its own tests reference is a candidate, and says so', async () => {
  const { root, transcripts } = createScannedFixture()

  write(
    path.join(root, 'library', 'skills', 'orphan-technique.md'),
    '# Orphan technique\n',
  )
  // The test is the only thing left that reaches the skill. That proves the
  // skill still works, never that anything needs it.
  write(
    path.join(root, 'tests', 'unit', 'orphan-technique.test.ts'),
    "// covers library/skills/orphan-technique.md\nexport const covered = 'library/skills/orphan-technique.md'\n",
  )

  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })

  const record = scanRecord(root)
  const usage = record.usage.find(
    (entry) => entry.facility_id === 'skill:orphan-technique',
  )

  assert.equal(usage?.evidence_tier, 'none')
  assert.equal(usage?.test_only_references, true)
  assert.ok(record.candidates.includes('skill:orphan-technique'))
  assert.match(
    readText(sessionPaths(root, SESSION).report),
    /Only its own tests reference it/u,
  )
})

test('the protected set is withheld from candidates and says why', async () => {
  const { root, transcripts } = createScannedFixture()

  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })

  const record = scanRecord(root)
  const principles = record.facilities.find(
    (entry) => entry.id === 'policy:PRINCIPLES-001',
  )

  assert.equal(principles?.protected, true)
  assert.match(principles?.protected_reason ?? '', /always-on/u)
  assert.equal(record.candidates.includes('policy:PRINCIPLES-001'), false)
  assert.equal(record.candidates.includes('command:pan-debloat'), false)
})

test('an operator selection cannot be widened past the candidate list', async () => {
  const { root, transcripts } = createScannedFixture()

  write(
    path.join(root, 'library', 'skills', 'orphan-technique.md'),
    '# Orphan technique\n',
  )
  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })

  assert.throws(
    () =>
      selectDebloatFacilities(root, SESSION, ['policy:PRINCIPLES-001'], NOW),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'DEBLOAT_SELECTION_INVALID' &&
      /not an unused candidate/u.test(error.message),
  )
  assert.throws(
    () => selectDebloatFacilities(root, SESSION, ['skill:invented'], NOW),
    (error: unknown) =>
      error instanceof PanError && /unknown facility/u.test(error.message),
  )

  recordDebloatAdjudication(
    root,
    SESSION,
    'skill:orphan-technique',
    'remove',
    'No functional consumer remains.',
    ['fixture scan'],
    NOW,
  )
  const selected = selectDebloatFacilities(
    root,
    SESSION,
    ['skill:orphan-technique'],
    NOW,
  )

  assert.deepEqual(selected.selected, ['skill:orphan-technique'])
})

test('impact splits deletions from repairs and records the adjudication', async () => {
  const { root, transcripts } = createScannedFixture()

  write(
    path.join(root, 'library', 'skills', 'orphan-technique.md'),
    '# Orphan technique\n',
  )
  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })
  recordDebloatAdjudication(
    root,
    SESSION,
    'skill:orphan-technique',
    'remove',
    'No functional consumer remains.',
    ['fixture scan'],
    NOW,
  )
  selectDebloatFacilities(root, SESSION, ['skill:orphan-technique'], NOW)

  const summary = await computeDebloatImpact(root, SESSION, NOW)
  const closure = readJson(sessionPaths(root, SESSION).closure) as {
    remove: Array<{ path: string }>
    adjudication_required: string[]
  }

  assert.equal(summary.remove_count, 1)
  assert.deepEqual(
    closure.remove.map((entry) => entry.path),
    ['library/skills/orphan-technique.md'],
  )
  assert.equal(closure.adjudication_required.length, 3)
})

test('verify fails on a surviving path and on a dangling reference', async () => {
  const { root, transcripts } = createScannedFixture()

  write(
    path.join(root, 'library', 'skills', 'orphan-technique.md'),
    '# Orphan technique\n',
  )
  await scanDebloat(root, {
    sessionId: SESSION,
    now: NOW,
    transcriptsRoot: transcripts,
  })
  recordDebloatAdjudication(
    root,
    SESSION,
    'skill:orphan-technique',
    'remove',
    'No functional consumer remains.',
    ['fixture scan'],
    NOW,
  )
  selectDebloatFacilities(root, SESSION, ['skill:orphan-technique'], NOW)
  await computeDebloatImpact(root, SESSION, NOW)

  const before = await verifyDebloat(root, SESSION, NOW)

  assert.equal(before.status, 'incomplete')
  assert.equal(before.surviving_path_count, 1)

  // Remove the file but leave a reference behind, which is the failure a type
  // check cannot see in a Markdown-only removal.
  rmSync(path.join(root, 'library', 'skills', 'orphan-technique.md'))
  write(
    path.join(root, 'docs', 'leftover.md'),
    'See `library/skills/orphan-technique.md`.\n',
  )

  const dangling = await verifyDebloat(root, SESSION, NOW)

  assert.equal(dangling.status, 'incomplete')
  assert.equal(dangling.surviving_path_count, 0)
  assert.equal(dangling.dangling_reference_count, 1)

  rmSync(path.join(root, 'docs', 'leftover.md'))

  assert.equal((await verifyDebloat(root, SESSION, NOW)).status, 'clean')
})

test('a step run out of order names the command that produces its input', async () => {
  const { root } = createScannedFixture()

  await assert.rejects(
    computeDebloatImpact(root, SESSION, NOW),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'DEBLOAT_SESSION_INCOMPLETE' &&
      /pan debloat scan/u.test(error.message),
  )
})
