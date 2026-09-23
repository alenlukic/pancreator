import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'

import {
  selectDebloatFacilities,
  sessionPaths,
  recordDebloatAdjudication,
  type DebloatScanRecord,
} from '../../src/lib/debloat.js'
import type { CandidateAssessment } from '../../src/lib/debloat/adjudication.js'
import type { Facility } from '../../src/lib/debloat/inventory.js'
import { PanError } from '../../src/lib/errors.js'
import { createTestTempDirectory } from '../temp.js'

const SESSION = '20260920-000000-abcdef'
const NOW = new Date('2026-09-20T00:00:00.000Z')

function command(name: string): Facility {
  return {
    id: `command:${name}`,
    category: 'command',
    name,
    path: `library/cursor/commands/${name}.md`,
    owned_paths: [`library/cursor/commands/${name}.md`],
    selectable: true,
    node_kind: 'facility',
    protected: false,
  }
}

/**
 * A scan session on disk, with the verdict each candidate carries.
 *
 * The verdict is the whole subject of these tests, so it is the only thing a
 * case has to state. Everything else is the empty shape a scan writes.
 */
function writeScan(
  root: string,
  facilities: readonly Facility[],
  verdicts: Record<string, CandidateAssessment['deterministic_verdict']>,
): void {
  const paths = sessionPaths(root, SESSION)
  const record: DebloatScanRecord = {
    schema_version: 1,
    session_id: SESSION,
    generated_at: NOW.toISOString(),
    window_days: 30,
    window_start: NOW.toISOString(),
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
    facilities: [...facilities],
    usage: [],
    candidates: facilities.map((entry) => entry.id),
    candidate_assessments: facilities.map((entry) => ({
      facility_id: entry.id,
      deterministic_verdict: verdicts[entry.id] ?? 'unused',
      deterministic_reason: 'Fixture verdict.',
    })),
    previews: [],
    orphan_findings: [],
    protected_candidates: [],
  }

  mkdirSync(paths.directory, { recursive: true })
  writeFileSync(paths.candidates, `${JSON.stringify(record, null, 2)}\n`)
}

function rejection(error: unknown, pattern: RegExp): boolean {
  return (
    error instanceof PanError &&
    error.code === 'DEBLOAT_SELECTION_INVALID' &&
    pattern.test(error.message)
  )
}

test('selection accumulates across calls and replace resets it', () => {
  const root = createTestTempDirectory('debloat-selection')

  writeScan(root, [command('pan-one'), command('pan-two')], {})

  selectDebloatFacilities(root, SESSION, ['command:pan-one'], NOW)
  const accumulated = selectDebloatFacilities(
    root,
    SESSION,
    ['command:pan-two'],
    NOW,
  )

  assert.deepEqual(accumulated.selected, ['command:pan-one', 'command:pan-two'])

  const replaced = selectDebloatFacilities(
    root,
    SESSION,
    ['command:pan-two'],
    NOW,
    { replace: true },
  )

  assert.deepEqual(replaced.selected, ['command:pan-two'])
})

test('an unclear candidate enters the selection only after a remove verdict', () => {
  const root = createTestTempDirectory('debloat-selection-unclear')

  writeScan(root, [command('pan-unclear')], {
    'command:pan-unclear': 'unclear',
  })

  assert.throws(
    () => selectDebloatFacilities(root, SESSION, ['command:pan-unclear'], NOW),
    (error: unknown) =>
      rejection(error, /unclear candidate needs a remove adjudication/u),
  )

  // A `keep` verdict is a decision too, and it is not a licence to remove.
  recordDebloatAdjudication(
    root,
    SESSION,
    'command:pan-unclear',
    'keep',
    'The operator guide still routes to it.',
    ['docs/operator-guide.md'],
    NOW,
  )

  assert.throws(
    () => selectDebloatFacilities(root, SESSION, ['command:pan-unclear'], NOW),
    (error: unknown) =>
      rejection(error, /unclear candidate needs a remove adjudication/u),
  )

  recordDebloatAdjudication(
    root,
    SESSION,
    'command:pan-unclear',
    'remove',
    'No functional consumer remains.',
    ['fixture scan'],
    NOW,
  )

  assert.deepEqual(
    selectDebloatFacilities(root, SESSION, ['command:pan-unclear'], NOW)
      .selected,
    ['command:pan-unclear'],
  )
})

test('an agentic verdict never clears a deterministic retention', () => {
  const root = createTestTempDirectory('debloat-selection-retained')
  const paths = sessionPaths(root, SESSION)

  writeScan(root, [command('pan-kept')], { 'command:pan-kept': 'retained' })
  // Written directly because `pan debloat adjudicate` refuses a facility the
  // graph already retained. The record still must not unlock the selection.
  writeFileSync(
    paths.adjudication,
    `${JSON.stringify(
      {
        schema_version: 1,
        session_id: SESSION,
        adjudications: [
          {
            facility_id: 'command:pan-kept',
            verdict: 'remove',
            reasoning: 'An agent disagreed with the graph.',
            evidence: ['fixture'],
            recorded_at: NOW.toISOString(),
          },
        ],
      },
      null,
      2,
    )}\n`,
  )

  assert.throws(
    () => selectDebloatFacilities(root, SESSION, ['command:pan-kept'], NOW),
    (error: unknown) => rejection(error, /not an unused candidate/u),
  )
})
