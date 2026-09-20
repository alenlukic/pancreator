import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  INVOCATION_ALIAS_FILE,
  archiveWorkflowDirectories,
  finalizeWorkflowArtifacts,
  migrateRunSuffixes,
  maintainWorkflowRuntime,
  migrateWorkflowNames,
  migratedRunId,
  mutableRuntimeFiles,
  mutableRuntimeTraversalCount,
  repairWorkflowInboxReferences,
  resolveRunCitation,
  rewriteWorkflowArtifacts,
  standardizeRuntimeFileNames,
} from '../../src/lib/workflow-artifacts.js'
import { inboxTemporalScanDirectories } from '../../src/lib/inbox.js'
import { createTestTempDirectory } from '../temp.js'
function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

function writeWorkflowSnapshot(runDirectory: string): void {
  write(
    path.join(runDirectory, 'workflow.snapshot.json'),
    `${JSON.stringify({
      stages: [{ slug: 'plan' }, { slug: 'implement' }, { slug: 'verify' }],
    })}\n`,
  )
}

function writeEvents(runDirectory: string, invocationIds: string[]): void {
  const events = invocationIds.map((invocationId, index) =>
    JSON.stringify({
      schema_version: 1,
      type: 'invocation_prepared',
      timestamp: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      invocation_id: invocationId,
    }),
  )

  write(path.join(runDirectory, 'events.jsonl'), `${events.join('\n')}\n`)
}

function writeInvocation(
  runDirectory: string,
  runId: string,
  invocationId: string,
  index: number,
): void {
  write(
    path.join(runDirectory, 'invocations', `${invocationId}.json`),
    `${JSON.stringify({
      run_id: runId,
      invocation_id: invocationId,
      created_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      output: {
        path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
    })}\n`,
  )
}

function writeState(
  rootOrDirectory: string,
  runId: string,
  status: 'running' | 'succeeded',
  invocationIds: string[] = [],
  createdAt = '2026-06-22T21:22:54.051Z',
): void {
  const runDirectory = invocationIds.length
    ? rootOrDirectory
    : path.join(rootOrDirectory, 'runtime/logs/workflows', runId)

  write(
    path.join(runDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      title: 'fixture',
      status,
      pending_action: {
        type: status === 'running' ? 'prepare_invocation' : 'none',
      },
      stage_history: invocationIds.map((invocationId, index) => ({
        invocation_id: invocationId,
        submitted_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
        record_path: `runtime/logs/workflows/${runId}/records/${invocationId}.md`,
      })),
      attempts: {},
      created_at: createdAt,
    })}\n`,
  )

  if (invocationIds.length === 0) {
    write(
      path.join(runDirectory, 'workflow.snapshot.json'),
      `${JSON.stringify({ stages: [{ slug: 'plan' }] })}\n`,
    )
    write(path.join(runDirectory, 'events.jsonl'), '')
  }
}

function writeLegacyArtifacts(
  runDirectory: string,
  runId: string,
  invocationIds: string[],
): void {
  invocationIds.forEach((invocationId) => {
    write(
      path.join(runDirectory, 'artifacts', `${invocationId}.md`),
      `Artifact ${invocationId}\n`,
    )
    write(
      path.join(runDirectory, 'artifacts', `${invocationId}.html`),
      `<main>Artifact ${invocationId}</main>\n`,
    )
    write(
      path.join(runDirectory, 'records', `${invocationId}.json`),
      `${JSON.stringify({
        run_id: runId,
        invocation_id: invocationId,
        artifacts: [
          {
            path: `runtime/logs/workflows/${runId}/artifacts/${invocationId}.md`,
          },
        ],
      })}\n`,
    )
    write(
      path.join(runDirectory, 'records', `${invocationId}.md`),
      `Record ${invocationId}\n`,
    )
  })
}

test('finalizeWorkflowArtifacts rejects non-terminal runs', () => {
  const root = createTestTempDirectory('pancreator-finalize-')
  const runId = '63379_Jun-22_5f354f23'

  writeState(root, runId, 'running')

  assert.throws(
    () => finalizeWorkflowArtifacts(root, runId),
    (error: unknown) =>
      error instanceof PanError && error.code === 'RUN_NOT_TERMINAL',
  )
})

test('finalization rewrites exact-run inbox references only', () => {
  const root = createTestTempDirectory('pancreator-finalize-inbox-')
  const runId = '63308_Sep-01-0091_finalize'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const invocationIds = ['plan-1-aaaaaaaa', 'verify-1-bbbbbbbb']

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, invocationIds)
  writeState(runDirectory, runId, 'succeeded', invocationIds)
  writeLegacyArtifacts(runDirectory, runId, invocationIds)

  for (const [index, invocationId] of invocationIds.entries()) {
    writeInvocation(runDirectory, runId, invocationId, index)
    write(
      path.join(runDirectory, 'outputs', `${invocationId}.json`),
      `${JSON.stringify({ invocation_id: invocationId })}\n`,
    )
    write(
      path.join(runDirectory, 'evidence', `${invocationId}.log`),
      `Evidence for ${invocationId}\n`,
    )
    write(
      path.join(runDirectory, 'assessments', `assessment-${invocationId}.json`),
      `${JSON.stringify({ invocation_id: invocationId })}\n`,
    )
  }

  const selectedInbox = path.join(
    root,
    'runtime/inbox',
    `${runId}-verify-warnings.md`,
  )
  const referencedPaths = [
    `runtime/logs/workflows/${runId}/invocations/${invocationIds[0]}.json`,
    `runtime/logs/workflows/${runId}/outputs/${invocationIds[0]}.json`,
    `runtime/logs/workflows/${runId}/evidence/${invocationIds[0]}.log`,
    `runtime/logs/workflows/${runId}/assessments/assessment-${invocationIds[0]}.json`,
    `runtime/logs/workflows/${runId}/artifacts/${invocationIds[0]}.md`,
  ]

  write(
    selectedInbox,
    `${referencedPaths.map((item) => `- \`${item}\``).join('\n')}\n`,
  )

  const unrelatedInbox = path.join(root, 'runtime/inbox/unrelated.md')
  const unrelatedContent = `Keep ${invocationIds[0]} unchanged.\n`

  write(unrelatedInbox, unrelatedContent)
  finalizeWorkflowArtifacts(root, runId)

  const updated = readFileSync(selectedInbox, 'utf8')
  const finalInvocationId = '01_plan-1_aaaaaaaa'

  assert.ok(updated.includes(finalInvocationId))
  assert.ok(!updated.includes(invocationIds[0]))

  for (const match of updated.matchAll(/`([^`]+)`/gu)) {
    assert.equal(existsSync(path.join(root, match[1])), true, match[1])
  }

  assert.equal(readFileSync(unrelatedInbox, 'utf8'), unrelatedContent)
})

// A prefix moves twice: once while the run is live and the stage count
// grows, and once when the run closes and the ids invert. Every path an
// operator, an inbox item, or a report wrote down between those passes stops
// resolving, and nothing inside the run says where it went.
test('finalization leaves an alias from every in-flight invocation prefix to its final one', () => {
  const root = createTestTempDirectory('pancreator-alias-')
  const runId = '63308_Sep-01-0091_aliases'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const original = ['999_plan-1_02e65dfc', '998_implement-1_12e65dfc']

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, original)
  writeState(runDirectory, runId, 'running', original)

  for (const [index, invocationId] of original.entries()) {
    writeInvocation(runDirectory, runId, invocationId, index)
    write(
      path.join(runDirectory, 'invocations', `${invocationId}.md`),
      `Contract ${invocationId}\n`,
    )
  }

  const citation = `runtime/logs/workflows/${runId}/invocations/${original[0]}.md`

  // The live run resequences its prefixes, then closes and inverts them.
  rewriteWorkflowArtifacts(root, runId, 'in-flight')

  const intermediate = ['99_plan-1_02e65dfc', '98_implement-1_12e65dfc']

  assert.equal(
    existsSync(
      path.join(runDirectory, 'invocations', `${intermediate[0]}.json`),
    ),
    true,
  )

  writeState(runDirectory, runId, 'succeeded', intermediate)
  finalizeWorkflowArtifacts(root, runId)

  const final = ['01_plan-1_02e65dfc', '00_implement-1_12e65dfc']
  const aliases = JSON.parse(
    readFileSync(path.join(runDirectory, INVOCATION_ALIAS_FILE), 'utf8'),
  ) as { run_id: string; aliases: Record<string, string> }

  assert.equal(aliases.run_id, runId)
  // Both the id the run started with and the one it carried in between
  // resolve to the id it holds now; the first pass's alias was repointed
  // rather than left aimed at an id that no longer exists.
  assert.deepEqual(aliases.aliases, {
    [original[0]]: final[0],
    [original[1]]: final[1],
    [intermediate[0]]: final[0],
    [intermediate[1]]: final[1],
  })

  // The oldest citation resolves to a path that exists, which is the whole
  // point of keeping the map.
  const resolved = resolveRunCitation(root, runId, citation)

  assert.equal(resolved.aliased, true)
  assert.equal(
    resolved.resolved,
    `runtime/logs/workflows/${runId}/invocations/${final[0]}.md`,
  )
  assert.equal(resolved.path, resolved.resolved)
  assert.ok(resolved.path)
  assert.equal(existsSync(path.join(root, resolved.path)), true)

  // A bare id resolves to the card a reader following the citation wants.
  assert.equal(
    resolveRunCitation(root, runId, intermediate[1]).path,
    `runtime/logs/workflows/${runId}/invocations/${final[1]}.md`,
  )

  // A citation the map does not cover comes back untouched rather than
  // guessed at.
  const untouched = resolveRunCitation(root, runId, 'state.json')

  assert.equal(untouched.aliased, false)
  assert.equal(untouched.resolved, 'state.json')
})

// The resolver answers for one run, and a citation is operator-supplied
// text. A candidate that leaves the run has to come back as no answer rather
// than as a path the run does not hold.
test('a citation that escapes the run resolves to nothing', () => {
  const root = createTestTempDirectory('pancreator-citation-')
  const outside = createTestTempDirectory('pancreator-citation-outside-')
  const outsideFile = path.join(outside, 'hosts')

  const runId = '63308_Sep-01-0092_citation'
  const siblingRunId = '63308_Sep-01-0093_sibling'

  writeState(root, runId, 'succeeded')
  writeState(root, siblingRunId, 'succeeded')
  write(outsideFile, 'escaped\n')

  // The run's own artifact still resolves, so the containment refuses only
  // what it is meant to refuse.
  const own = `runtime/logs/workflows/${runId}/state.json`

  assert.equal(resolveRunCitation(root, runId, own).path, own)

  // A traversal out of the installation that names a file which exists: the
  // existence probe reported this path before the candidates were contained.
  const escape = path.relative(root, outsideFile)

  assert.ok(escape.startsWith('..'), escape)
  assert.equal(existsSync(path.join(root, escape)), true)
  assert.equal(resolveRunCitation(root, runId, escape).path, null)
  assert.equal(
    resolveRunCitation(root, runId, '../../../../etc/hosts').path,
    null,
  )

  // Another run's artifact is inside the installation and still outside the
  // answer this resolver is asked for.
  const sibling = `runtime/logs/workflows/${siblingRunId}/state.json`

  assert.equal(existsSync(path.join(root, sibling)), true)
  assert.equal(resolveRunCitation(root, runId, sibling).path, null)
})

test('historical repair reports unique changes and preserves ambiguities', () => {
  const root = createTestTempDirectory('pancreator-repair-inbox-')
  const runId = '63308_Sep-01-0091_repair'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const invocationIds = [
    '02_plan-1_aaaaaaaa',
    '01_plan-1_aaaaaaaa',
    '00_verify-1_bbbbbbbb',
  ]

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, invocationIds)
  writeState(runDirectory, runId, 'succeeded', invocationIds)

  const uniquePath = path.join(root, 'runtime/inbox', `${runId}-friction.md`)
  const ambiguousPath = path.join(root, 'runtime/inbox', `${runId}-warnings.md`)
  const unrelatedPath = path.join(root, 'runtime/inbox/other-run.md')
  const immutablePath = path.join(
    runDirectory,
    `state-revision-1-${'a'.repeat(64)}.json`,
  )

  const ambiguousContent = 'Reference plan-1-aaaaaaaa must stay unchanged.\n'
  const unrelatedContent = 'Reference verify-1-bbbbbbbb must stay unchanged.\n'
  const immutableContent = '{"invocation_id":"verify-1-bbbbbbbb"}\n'

  write(uniquePath, 'Reference verify-1-bbbbbbbb needs repair.\n')
  write(ambiguousPath, ambiguousContent)
  write(unrelatedPath, unrelatedContent)
  write(immutablePath, immutableContent)

  const summary = repairWorkflowInboxReferences(root)

  assert.deepEqual(summary.changed_paths, [
    `runtime/inbox/${runId}-friction.md`,
  ])
  assert.equal(
    readFileSync(uniquePath, 'utf8'),
    'Reference 00_verify-1_bbbbbbbb needs repair.\n',
  )
  assert.equal(readFileSync(ambiguousPath, 'utf8'), ambiguousContent)
  assert.equal(readFileSync(unrelatedPath, 'utf8'), unrelatedContent)
  assert.equal(readFileSync(immutablePath, 'utf8'), immutableContent)
  assert.deepEqual(summary.ambiguities, [
    {
      path: `runtime/inbox/${runId}-warnings.md`,
      reference: 'plan-1-aaaaaaaa',
      candidates: ['01_plan-1_aaaaaaaa', '02_plan-1_aaaaaaaa'],
    },
  ])

  assert.deepEqual(summary.skipped_runs, [])
  assert.deepEqual(repairWorkflowInboxReferences(root), {
    changed_paths: [],
    ambiguities: summary.ambiguities,
    skipped_runs: [],
  })
})

test('an unreadable run state skips that run and records the skip', () => {
  const root = createTestTempDirectory('pancreator-repair-skip-')
  const healthyRunId = '63308_Sep-01-0091_healthy'
  const brokenRunId = '63308_Sep-01-0092_broken'

  const healthyDirectory = path.join(
    root,
    'runtime/logs/workflows',
    healthyRunId,
  )
  const brokenDirectory = path.join(root, 'runtime/logs/workflows', brokenRunId)
  const invocationIds = ['00_verify-1_bbbbbbbb']

  writeWorkflowSnapshot(healthyDirectory)
  writeEvents(healthyDirectory, invocationIds)
  writeState(healthyDirectory, healthyRunId, 'succeeded', invocationIds)

  writeWorkflowSnapshot(brokenDirectory)
  writeEvents(brokenDirectory, invocationIds)
  write(path.join(brokenDirectory, 'state.json'), '{ not json\n')

  const repairPath = path.join(
    root,
    'runtime/inbox',
    `${healthyRunId}-friction.md`,
  )

  write(repairPath, 'Reference verify-1-bbbbbbbb needs repair.\n')

  // One malformed run used to abort the whole pass, which left every other
  // run's references unrepaired and named no cause.
  const summary = repairWorkflowInboxReferences(root)

  assert.deepEqual(summary.changed_paths, [
    `runtime/inbox/${healthyRunId}-friction.md`,
  ])
  assert.equal(summary.skipped_runs.length, 1)
  assert.equal(summary.skipped_runs[0]?.run_id, brokenRunId)
  assert.ok((summary.skipped_runs[0]?.reason ?? '').length > 0)
})

test('workflow migration finalizes closed runs and consolidates artifacts', () => {
  const root = createTestTempDirectory('pancreator-migration-')
  const oldRunId = '20260622T212254051Z-5f354f23'
  const newRunId = migratedRunId(oldRunId)

  assert.equal(newRunId, '63379_Jun-22-0158_5f354f23')
  assert.equal(
    migratedRunId(
      '63379_Jun-22_5f354f23',
      new Date('2026-06-22T21:22:54.051Z'),
    ),
    '63379_Jun-22-0158_5f354f23',
  )
  assert.equal(migratedRunId('63379_Jun-22-0158_5f354f23'), null)

  const logDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const stateDirectory = path.join(root, 'runtime/workflows', oldRunId)
  const oldInvocationIds = [
    'plan-1-02e65dfc',
    'implement-1-12e65dfc',
    'verify-1-22e65dfc',
    'implement-2-32e65dfc',
    'verify-2-42e65dfc',
  ]
  const newInvocationIds = [
    '04_plan-1_02e65dfc',
    '03_implement-1_12e65dfc',
    '02_verify-1_22e65dfc',
    '01_implement-2_32e65dfc',
    '00_verify-2_42e65dfc',
  ]

  writeWorkflowSnapshot(logDirectory)
  writeEvents(logDirectory, oldInvocationIds)
  writeState(logDirectory, oldRunId, 'succeeded', oldInvocationIds)
  writeLegacyArtifacts(logDirectory, oldRunId, oldInvocationIds)
  write(
    path.join(
      logDirectory,
      'evidence',
      '997_implement-2_d75285b9-installation-smoke.log',
    ),
    'Stage-owned evidence whose artifact-like filename is not an invocation.\n',
  )

  oldInvocationIds.forEach((invocationId, index) => {
    writeInvocation(logDirectory, oldRunId, invocationId, index)
  })

  write(
    path.join(stateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({
      workflow_id: oldRunId,
      invocation_id: oldInvocationIds[3],
    })}\n`,
  )
  mkdirSync(path.join(root, 'runtime/logs/workflows/--help'), {
    recursive: true,
  })

  const summary = migrateWorkflowNames(root)
  const migratedLogDirectory = path.join(
    root,
    'runtime/logs/workflows',
    newRunId,
  )
  const migratedStateDirectory = path.join(root, 'runtime/workflows', newRunId)

  assert.equal(summary.run_directories, 1)
  assert.equal(summary.state_directories, 1)
  assert.equal(summary.removed_invalid_directories, 1)
  assert.equal(existsSync(logDirectory), false)
  assert.equal(existsSync(migratedLogDirectory), true)
  assert.equal(existsSync(stateDirectory), false)
  assert.equal(existsSync(migratedStateDirectory), true)
  assert.equal(existsSync(path.join(migratedLogDirectory, 'records')), false)

  newInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(migratedLogDirectory, 'invocations', `${invocationId}.json`),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/json',
          `${invocationId}.json`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/markdown',
          `${invocationId}.md`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/html',
          `${invocationId}.html`,
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          migratedLogDirectory,
          'artifacts/markdown',
          `${invocationId}.record.md`,
        ),
      ),
      false,
    )
  })

  assert.match(
    readFileSync(
      path.join(migratedStateDirectory, 'modifications.jsonl'),
      'utf8',
    ),
    new RegExp(`${newRunId}.*${newInvocationIds[3]}`, 'u'),
  )
  const migratedState = readFileSync(
    path.join(migratedLogDirectory, 'state.json'),
    'utf8',
  )

  assert.doesNotMatch(migratedState, /\.record\.md/u)
  assert.match(
    migratedState,
    new RegExp(`artifacts/json/${newInvocationIds[0]}\\.json`, 'u'),
  )
  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    artifact_layout_files: 0,
    updated_files: 0,
    removed_invalid_directories: 0,
  })
})

test('workflow migration repairs in-flight prefixes without finalizing', () => {
  const root = createTestTempDirectory('pancreator-migration-')
  const runId = '63379_Jun-22_5f354f23'
  const migratedId = '63379_Jun-22-0158_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)

  const groupedInvocationIds = [
    '999_plan-1_02e65dfc',
    '997_implement-1_12e65dfc',
    '996_verify-1_22e65dfc',
    '997_implement-2_32e65dfc',
    '996_verify-2_42e65dfc',
  ]
  const sequencedInvocationIds = [
    '99_plan-1_02e65dfc',
    '98_implement-1_12e65dfc',
    '97_verify-1_22e65dfc',
    '96_implement-2_32e65dfc',
    '95_verify-2_42e65dfc',
  ]

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, groupedInvocationIds)
  writeState(runDirectory, runId, 'running', groupedInvocationIds)
  writeLegacyArtifacts(runDirectory, runId, groupedInvocationIds)

  groupedInvocationIds.forEach((invocationId, index) => {
    writeInvocation(runDirectory, runId, invocationId, index)
  })

  migrateWorkflowNames(root)

  sequencedInvocationIds.forEach((invocationId) => {
    assert.equal(
      existsSync(
        path.join(
          root,
          'runtime/logs/workflows',
          migratedId,
          'invocations',
          `${invocationId}.json`,
        ),
      ),
      true,
    )
  })

  assert.deepEqual(migrateWorkflowNames(root), {
    run_directories: 0,
    state_directories: 0,
    artifact_files: 0,
    artifact_layout_files: 0,
    updated_files: 0,
    removed_invalid_directories: 0,
  })
})

test('workflow archive moves runs older than retention into archive directories', () => {
  const root = createTestTempDirectory('pancreator-archive-')
  const oldRunId = '63379_Jun-22-0158_5f354f23'
  const recentRunId = '63372_Jun-29-0158_6f354f23'

  const oldLogDirectory = path.join(root, 'runtime/logs/workflows', oldRunId)
  const oldStateDirectory = path.join(root, 'runtime/workflows', oldRunId)
  const tuneRecord = path.join(
    root,
    'runtime/tune-harness/records/archive-fixture.json',
  )

  writeState(root, oldRunId, 'succeeded')
  writeState(root, recentRunId, 'running', [], '2026-06-29T21:22:54.051Z')
  write(
    path.join(oldStateDirectory, 'modifications.jsonl'),
    `${JSON.stringify({
      path: `runtime/logs/workflows/${oldRunId}/state.json`,
    })}\n`,
  )
  write(
    path.join(oldLogDirectory, 'evidence', 'path.txt'),
    `runtime/workflows/${oldRunId}/modifications.jsonl\n`,
  )
  write(tuneRecord, '{"schema_version":1,"session_id":"x"}\n')
  const tuneRecordBefore = readFileSync(tuneRecord)

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.run_ids, [oldRunId])
  assert.equal(summary.run_directories, 1)
  assert.equal(summary.state_directories, 1)
  assert.equal(existsSync(oldLogDirectory), false)
  assert.equal(existsSync(oldStateDirectory), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows/archive', oldRunId)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/workflows/archive', oldRunId)),
    true,
  )
  assert.ok(readFileSync(tuneRecord).equals(tuneRecordBefore))
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows', recentRunId, 'state.json'),
    ),
    true,
  )
  assert.match(
    readFileSync(
      path.join(
        root,
        'runtime/logs/workflows/archive',
        oldRunId,
        'evidence/path.txt',
      ),
      'utf8',
    ),
    /runtime\/workflows\/archive\//u,
  )

  assert.deepEqual(
    archiveWorkflowDirectories(root, {
      retentionDays: 7,
      now: new Date('2026-07-01T22:00:00.000Z'),
    }).run_ids,
    [],
  )
})

// `AUTO-001` lets a worker leave a task-specific script in the run's own
// directory, and nothing said who removes it. Finalization fires the moment a
// run closes, which is when an operator is still reading the record, so
// sweeping there would take evidence out from under the reader; leaving the
// scripts forever grows the runtime tree without bound.
test('retention sweeps run-local worker scripts and finalization keeps them', () => {
  const root = createTestTempDirectory('pancreator-scripts-')
  const runId = '63379_Jun-22-0158_5f354f23'
  const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
  const script = path.join(runDirectory, 'scripts', 'check-delta.mjs')

  const invocationIds = ['plan-1-aaaaaaaa']

  writeWorkflowSnapshot(runDirectory)
  writeEvents(runDirectory, invocationIds)
  writeState(runDirectory, runId, 'succeeded', invocationIds)
  writeInvocation(runDirectory, runId, invocationIds[0], 0)
  write(script, "console.log('one-run helper')\n")

  finalizeWorkflowArtifacts(root, runId)

  assert.equal(
    existsSync(script),
    true,
    'the closing run keeps the script a reader may still need',
  )

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.swept_script_run_ids, [runId])
  assert.equal(existsSync(script), false)
  // The sweep takes the scripts and nothing else: the rest of the run moves
  // into the archive intact.
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/archive', runId, 'scripts'),
    ),
    false,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/archive', runId, 'state.json'),
    ),
    true,
  )
})

test('runtime file names standardize onto the temporal prefix scheme', () => {
  const root = createTestTempDirectory('pan-names-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-archive-utils.md'),
    '# File prefix standardization\n',
  )
  write(
    path.join(
      root,
      'runtime/inbox/queue/request-20260812T035755Z-worktree-management.md',
    ),
    'Manage worktrees.\n',
  )
  write(
    path.join(root, 'runtime/inbox/queue/request-20260810T054345Z-6df4ab84.md'),
    'Implement a best-of-n mode for the dev workflow.\n',
  )
  write(
    path.join(
      root,
      'runtime/pr-descriptions/20260803T165512Z-invocation-fixes-against-main.md',
    ),
    'PR body.\n',
  )
  write(
    path.join(root, 'runtime/logs/workflows/some-run/state.json'),
    `${JSON.stringify({
      request: {
        source_path: 'runtime/inbox/queue/2026-08-14-archive-utils.md',
      },
    })}\n`,
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 4)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63326_Aug-14-0720_archive-utils.md'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/queue/63328_Aug-12-1203_worktree-management.md',
      ),
    ),
    true,
  )
  // The opaque hex slug is replaced by keywords from the file content.
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63330_Aug-10-1097_implement-be.md'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/pr-descriptions/63337_Aug-03-0425_invocation-fixes-against-main.md',
      ),
    ),
    true,
  )
  // Persisted references follow the rename.
  assert.match(
    readFileSync(
      path.join(root, 'runtime/logs/workflows/some-run/state.json'),
      'utf8',
    ),
    /runtime\/inbox\/queue\/63326_Aug-14-0720_archive-utils\.md/u,
  )
  // A second pass finds nothing left to standardize.
  assert.equal(standardizeRuntimeFileNames(root).renamed_files, 0)
})

// `pan archive` renamed all 13 queued harness repair intakes out of the shape
// `REPAIR-001` mandates and left 20 by-name cross-references dangling, because
// standardization rewrites a bare file name that the reference repair, which
// maps whole relative paths, cannot follow.
test('standardization leaves policy-mandated inbox names and their citations alone', () => {
  const root = createTestTempDirectory('pan-names-policy-')
  const intake =
    'harness-repair-20260917T215829Z-build-release-sync-and-validator-routing.md'
  const related = 'harness-repair-20260918T061754Z-int-con-ship-scope-window.md'
  const escalation = 'spotfix-escalation-20260918T083300Z-pan-archive.md'

  write(
    path.join(root, 'runtime/inbox/queue', intake),
    `# Build intake\n\nLand \`${related}\` first.\n`,
  )
  write(path.join(root, 'runtime/inbox/queue', related), '# Consistency\n')
  write(path.join(root, 'runtime/inbox/queue', escalation), '# Escalation\n')
  // An ordinary request in the same directory still standardizes, so the
  // exemption is the mandated name rather than the directory.
  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-archive-utils.md'),
    'Ordinary request.\n',
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.deepEqual(Object.keys(summary.renames), [
    'runtime/inbox/queue/2026-08-14-archive-utils.md',
  ])
  assert.equal(existsSync(path.join(root, 'runtime/inbox/queue', intake)), true)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', related)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', escalation)),
    true,
  )
  // The cross-reference still resolves, which is the contract the rename broke.
  const citation = readFileSync(
    path.join(root, 'runtime/inbox/queue', intake),
    'utf8',
  ).match(/`([^`]+)`/u)

  assert.ok(citation)
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/queue', citation[1])),
    true,
  )
})

// The exemption is bounded by the mandated shape. A name that only borrows the
// prefix carries no UTC timestamp, so it has no age of its own and must still
// be standardized rather than sit unarchivable in a status directory.
test('a policy prefix without a mandated UTC timestamp still standardizes', () => {
  const root = createTestTempDirectory('pan-names-policy-near-miss-')
  const nearMisses = [
    'harness-repair-notes.md',
    'harness-repair-2026-09-17-draft.md',
    'spotfix-escalation-20260918T0833Z-truncated.md',
  ]

  for (const name of nearMisses) {
    write(path.join(root, 'runtime/inbox/queue', name), 'Near miss.\n')
  }

  assert.equal(standardizeRuntimeFileNames(root).renamed_files, 3)

  for (const name of nearMisses) {
    assert.equal(
      existsSync(path.join(root, 'runtime/inbox/queue', name)),
      false,
      name,
    )
  }
})

// Standardization is what gave an inbox item an archivable age, so exempting a
// name must not make it immortal in a terminal status directory.
test('a policy-mandated inbox item still archives on the age its name carries', () => {
  const root = createTestTempDirectory('pan-archive-policy-')
  const stale = 'harness-repair-20260622T211500Z-test-issues-flaky-lane.md'
  const fresh = 'harness-repair-20260629T211500Z-compliance-card-drift.md'

  write(path.join(root, 'runtime/inbox/complete', stale), '# Stale\n')
  write(path.join(root, 'runtime/inbox/complete', fresh), '# Fresh\n')

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.inbox_files, [stale])
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/archive', stale)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/inbox/complete', fresh)),
    true,
  )
})

test('run directory hash suffixes migrate to keyword suffixes', () => {
  const root = createTestTempDirectory('pan-suffixes-')
  const first = '63379_Jun-22-0158_5f354f23'
  const second = '63379_Jun-22-0157_6f354f23'
  const sameMinute = '63379_Jun-22-0158_7f354f23'

  writeState(root, first, 'succeeded')
  writeState(root, second, 'succeeded')
  writeState(root, sameMinute, 'succeeded')
  write(
    path.join(root, 'runtime/workflows', first, 'modifications.jsonl'),
    `${JSON.stringify({ run_id: first })}\n`,
  )
  write(
    path.join(
      root,
      'runtime/logs/sessions/63379_Jun-22-0158_aaaa1111',
      'pair-card.md',
    ),
    '# Pair programming\n',
  )
  write(
    path.join(
      root,
      'runtime/logs/best-of-n/63379_Jun-22-0158_bbbb2222',
      'state.json',
    ),
    `${JSON.stringify({
      bon_id: '63379_Jun-22-0158_bbbb2222',
      request: {
        source_path: 'runtime/inbox/2026-06-22-output-simplification.md',
      },
    })}\n`,
  )

  const summary = migrateRunSuffixes(root)

  // All runs share the fixture title, so the same-minute run keeps the keywords
  // with an ordinal.
  assert.equal(summary.run_directories, 3)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0158_fixture-2'),
    ),
    true,
  )
  assert.equal(summary.session_directories, 1)
  assert.equal(summary.best_of_n_directories, 1)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0158_fixture'),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/workflows/63379_Jun-22-0157_fixture'),
    ),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/workflows/63379_Jun-22-0158_fixture')),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/sessions/63379_Jun-22-0158_pair')),
    true,
  )
  assert.equal(
    existsSync(
      path.join(root, 'runtime/logs/best-of-n/63379_Jun-22-0158_output-simpl'),
    ),
    true,
  )
  assert.match(
    readFileSync(
      path.join(
        root,
        'runtime/workflows/63379_Jun-22-0158_fixture/modifications.jsonl',
      ),
      'utf8',
    ),
    /63379_Jun-22-0158_fixture/u,
  )
  // A second pass has nothing hex-suffixed left.
  assert.equal(migrateRunSuffixes(root).run_directories, 0)
})

test('suffix migration skips best-of-N sessions with live worktrees at the current root', () => {
  const root = createTestTempDirectory('pan-suffix-worktree-current-')
  const bonId = '63379_Jun-22-0158_dddd4444'
  const legacyBonId = '63379_Jun-22-0158_cccc3333'

  for (const id of [bonId, legacyBonId]) {
    write(
      path.join(root, 'runtime/logs/best-of-n', id, 'state.json'),
      `${JSON.stringify({
        bon_id: id,
        request: { source_path: 'runtime/inbox/2026-06-22-live-session.md' },
      })}\n`,
    )
  }
  mkdirSync(path.join(root, 'worktrees', bonId, 'slot-a'), {
    recursive: true,
  })
  // The legacy runtime/worktrees location counts as live just the same.
  mkdirSync(path.join(root, 'runtime/worktrees', legacyBonId, 'slot-a'), {
    recursive: true,
  })

  const summary = migrateRunSuffixes(root)

  assert.equal(summary.best_of_n_directories, 0)
  assert.deepEqual(
    [...summary.skipped_directories].sort(),
    [
      `runtime/logs/best-of-n/${bonId}`,
      `runtime/logs/best-of-n/${legacyBonId}`,
    ].sort(),
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n', legacyBonId)),
    true,
  )
})

test('archival covers best-of-N sessions and temporal runtime files', () => {
  const root = createTestTempDirectory('pan-archive-extended-')
  const oldBonId = '63379_Jun-22-0158_output-simpl'
  const freshBonId = '63372_Jun-29-0158_other-keywor'

  const oldSessionId = '63379_Jun-22-0158_aaaaaaaa'
  const freshSessionId = '63372_Jun-29-0158_bbbbbbbb'
  const oldSession = path.join(root, 'runtime/logs/sessions', oldSessionId)
  const freshSession = path.join(root, 'runtime/logs/sessions', freshSessionId)

  write(path.join(oldSession, 'pair-card.md'), '# Pair programming\n')
  write(path.join(freshSession, 'pair-card.md'), '# Pair programming\n')
  write(
    path.join(root, 'runtime/logs/best-of-n', oldBonId, 'state.json'),
    `${JSON.stringify({
      bon_id: oldBonId,
      created_at: '2026-06-22T21:22:54.051Z',
    })}\n`,
  )
  write(
    path.join(root, 'runtime/logs/best-of-n', freshBonId, 'state.json'),
    `${JSON.stringify({
      bon_id: freshBonId,
      created_at: '2026-06-29T21:22:54.051Z',
    })}\n`,
  )
  write(
    path.join(root, 'runtime/inbox/complete/63379_Jun-22-0158_stale-reques.md'),
    'Stale request.\n',
  )
  write(
    path.join(root, 'runtime/inbox/complete/63372_Jun-29-0158_fresh-reques.md'),
    'Fresh request.\n',
  )
  write(
    path.join(
      root,
      'runtime/pr-descriptions/63379_Jun-22-0158_stale-pr-against-main.md',
    ),
    'Stale PR body.\n',
  )

  const summary = archiveWorkflowDirectories(root, {
    retentionDays: 7,
    now: new Date('2026-07-01T22:00:00.000Z'),
  })

  assert.deepEqual(summary.bon_ids, [oldBonId])
  assert.equal(summary.best_of_n_directories, 1)
  assert.deepEqual(summary.inbox_files, ['63379_Jun-22-0158_stale-reques.md'])
  assert.deepEqual(summary.pr_description_files, [
    '63379_Jun-22-0158_stale-pr-against-main.md',
  ])
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n/archive', oldBonId)),
    true,
  )
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/best-of-n', freshBonId)),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/archive/63379_Jun-22-0158_stale-reques.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/inbox/complete/63372_Jun-29-0158_fresh-reques.md',
      ),
    ),
    true,
  )
  assert.equal(
    existsSync(
      path.join(
        root,
        'runtime/pr-descriptions/archive/63379_Jun-22-0158_stale-pr-against-main.md',
      ),
    ),
    true,
  )
  // Standalone cards live outside the workflow tree but are just as disposable;
  // without this they accumulate for the life of the installation.
  assert.deepEqual(summary.session_ids, [oldSessionId])
  assert.equal(summary.session_directories, 1)
  assert.equal(existsSync(oldSession), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/sessions/archive', oldSessionId)),
    true,
  )
  // A session inside the retention window is untouched.
  assert.equal(existsSync(freshSession), true)
})

test('runtime name standardization never scans or rewrites worktree checkouts', () => {
  const root = createTestTempDirectory('pan-names-worktrees-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-scoped-rename.md'),
    'Scoped rename fixture.\n',
  )
  // A reference inside a worktree checkout must stay untouched: worktrees are
  // target source trees, not runtime records.
  write(
    path.join(root, 'runtime/worktrees/operator/wt/notes.md'),
    'see runtime/inbox/queue/2026-08-14-scoped-rename.md\n',
  )
  write(
    path.join(root, 'runtime/logs/orchestrator/events.jsonl'),
    `${JSON.stringify({ path: 'runtime/inbox/queue/2026-08-14-scoped-rename.md' })}\n`,
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 1)
  assert.match(
    readFileSync(
      path.join(root, 'runtime/logs/orchestrator/events.jsonl'),
      'utf8',
    ),
    /63326_Aug-14-0720_scoped-rename\.md/u,
  )
  assert.equal(
    readFileSync(
      path.join(root, 'runtime/worktrees/operator/wt/notes.md'),
      'utf8',
    ),
    'see runtime/inbox/queue/2026-08-14-scoped-rename.md\n',
  )
})

// AC-009 and AC-010. The rewrite repairs invocation ids quoted inside a run's
// own inbox item after terminal renumbering. Its scanner read the inbox root
// alone, which was right until the lifecycle partition moved every new item
// into `queue/`; from then on it matched nothing and the rewrite was silent
// dead code. Every lifecycle directory is covered, so an item that moves
// during a run stays reachable.
test('the finalization rewrite reaches a run-owned inbox item in every lifecycle directory', () => {
  for (const lifecycle of inboxTemporalScanDirectories()) {
    const root = createTestTempDirectory('pancreator-finalize-lifecycle-')
    const runId = '63308_Sep-01-0091_lifecycle'
    const runDirectory = path.join(root, 'runtime/logs/workflows', runId)
    const invocationIds = ['plan-1-aaaaaaaa', 'verify-1-bbbbbbbb']

    writeWorkflowSnapshot(runDirectory)
    writeEvents(runDirectory, invocationIds)
    writeState(runDirectory, runId, 'succeeded', invocationIds)

    for (const [index, invocationId] of invocationIds.entries()) {
      writeInvocation(runDirectory, runId, invocationId, index)
    }

    const item = path.join(root, lifecycle, `${runId}-friction.md`)
    const quoted = `runtime/logs/workflows/${runId}/invocations/${invocationIds[0]}.json`

    write(item, `- \`${quoted}\`\n`)
    finalizeWorkflowArtifacts(root, runId)

    const updated = readFileSync(item, 'utf8')

    assert.ok(
      updated.includes('01_plan-1_aaaaaaaa'),
      `${lifecycle}: ${updated}`,
    )
    assert.ok(!updated.includes(invocationIds[0]), `${lifecycle}: ${updated}`)

    // The rewritten path must resolve, which is the whole point of repairing
    // it: a quoted path that no longer exists is worse than an unrepaired one.
    for (const match of updated.matchAll(/`([^`]+)`/gu)) {
      assert.equal(existsSync(path.join(root, match[1])), true, match[1])
    }
  }
})

// AC-025. The standardizer scanned two directory sets through two copies of
// the same loop, and a fix applied to one copy silently skipped the other.
test('the runtime name standardizer holds one traversal helper', () => {
  const source = readFileSync('src/lib/workflow-artifacts.ts', 'utf8')
  const standardizer = source.slice(
    source.indexOf('function standardizeTemporalFileNamesIn'),
    source.indexOf('export interface RunSuffixMigrationSummary'),
  )

  // One traversal, in the helper. The two copies this replaced differed only
  // in the directory they walked, so a repair applied to one left the other
  // behind.
  assert.equal(standardizer.match(/readdirSync\(/gu)?.length, 1, standardizer)
  assert.match(
    standardizer,
    /standardizeTemporalFileNamesIn\(\s*root,\s*parentRelative,\s*mappings,\s*mutableFileSet,/u,
  )
})

test('name standardization is unchanged across the directories it already scanned', () => {
  const root = createTestTempDirectory('pan-names-one-helper-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-first.md'),
    'First fixture.\n',
  )
  write(
    path.join(root, 'runtime/logs/sessions/2026-08-12-second/notes.md'),
    'Second fixture.\n',
  )

  const summary = standardizeRuntimeFileNames(root)

  assert.equal(summary.renamed_files, 1)
  assert.equal(
    existsSync(
      path.join(root, 'runtime/inbox/queue/63326_Aug-14-0720_first.md'),
    ),
    true,
  )
})

test('mutable runtime rewrites include durable records and exclude scratch and unknown directories', () => {
  const root = createTestTempDirectory('pancreator-mutable-runtime-')
  const runtimeRoot = path.join(root, 'runtime')
  const durable = path.join(
    runtimeRoot,
    'logs',
    'workflows',
    'run',
    'state.json',
  )
  // Two durable series the first allowlist missed: a run id lives in both, and
  // neither is reachable through a `runtime/logs` entry.
  const allocations = path.join(runtimeRoot, 'release', 'allocations.jsonl')
  const series = path.join(runtimeRoot, 'fast-wall-series.jsonl')
  const scratch = path.join(runtimeRoot, 'tmp', 'scratch.txt')
  const unknown = path.join(runtimeRoot, 'future-area', 'record.json')

  write(durable, '{}\n')
  write(allocations, '{}\n')
  write(series, '{}\n')
  write(scratch, 'scratch\n')
  write(unknown, '{}\n')

  assert.deepEqual(
    mutableRuntimeFiles(runtimeRoot).sort(),
    [series, allocations, durable].sort(),
  )
})

// AC-010. The rewrite population was narrowed to an allowlist, and a durable
// run id outside `runtime/logs` is the reference that narrowing can silently
// drop: an append-only audit row that kept a retired id outlives the run.
test('a run-id migration rewrites durable records outside the workflow logs', () => {
  const root = createTestTempDirectory('pancreator-durable-rewrite-')
  const runId = '63379_Jun-22-0158_5f354f23'
  const allocations = path.join(root, 'runtime/release/allocations.jsonl')
  const series = path.join(root, 'runtime/fast-wall-series.jsonl')

  writeState(root, runId, 'succeeded')
  write(
    allocations,
    `${JSON.stringify({ schema_version: 1, version: '6.22.0', run_id: runId })}\n`,
  )
  write(
    series,
    `${JSON.stringify({ schema_version: 3, run_id: runId, wall_clock_ms: 1 })}\n`,
  )

  const summary = migrateRunSuffixes(root)
  const migrated = '63379_Jun-22-0158_fixture'

  assert.equal(summary.run_directories, 1)
  assert.match(readFileSync(allocations, 'utf8'), /63379_Jun-22-0158_fixture/u)
  assert.match(readFileSync(series, 'utf8'), /63379_Jun-22-0158_fixture/u)
  assert.equal(readFileSync(allocations, 'utf8').includes(runId), false)
  assert.equal(readFileSync(series, 'utf8').includes(runId), false)
  assert.equal(
    existsSync(path.join(root, 'runtime/logs/workflows', migrated)),
    true,
  )
})

// AC-011. The guard has to fail when a pass walks the runtime tree again, so
// it counts the walks themselves and the fixture gives two passes real
// mappings: a counter read after a no-op maintenance proves nothing.
test('runtime maintenance walks the mutable population once across all passes', () => {
  const root = createTestTempDirectory('pancreator-runtime-scan-')

  write(
    path.join(root, 'runtime/inbox/queue/2026-08-14-first.md'),
    'First fixture.\n',
  )
  writeState(root, '63379_Jun-22-0158_5f354f23', 'succeeded')

  const before = mutableRuntimeTraversalCount()
  const summary = maintainWorkflowRuntime(root, { retentionDays: 36500 })

  assert.equal(summary.names.renamed_files, 1)
  assert.equal(summary.suffixes.run_directories, 1)
  assert.equal(mutableRuntimeTraversalCount() - before, 1)
})
