import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  INVOCATION_ALIAS_FILE,
  finalizeWorkflowArtifacts,
  migrateWorkflowNames,
  migratedRunId,
  repairWorkflowInboxReferences,
  resolveRunCitation,
  rewriteWorkflowArtifacts,
} from '../../src/lib/workflow-artifacts.js'
import { inboxTemporalScanDirectories } from '../../src/lib/inbox.js'
import { createTestTempDirectory } from '../temp.js'
import {
  write,
  writeEvents,
  writeInvocation,
  writeState,
  writeWorkflowSnapshot,
} from './workflow-artifacts-helpers.js'

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
