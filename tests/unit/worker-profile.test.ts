import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CURSOR_TRANSCRIPTS_ENV,
  effectiveShellCommand,
  findInvocationTranscripts,
  formatWorkerProfileReport,
  generateWorkerProfileReport,
  isShellBrowsingCommand,
  isUnfilteredTestCommand,
  profileWorkerTranscript,
  stageFromInvocationId,
  workerInvocationSuiteCost,
} from '../../src/lib/worker-profile.js'
import { createTestTempDirectory } from '../temp.js'

const RUN_ID = '63300_Sep-29-0001_profile-fixture'
const IMPLEMENT_ID = '99_implement-1_921937a8'
const REMEDIATE_ID = '98_remediate-2_0badcafe'

type Tool = [name: string, input: Record<string, unknown>]

function opening(invocationId: string, suffix = '.md'): string {
  return JSON.stringify({
    role: 'user',
    message: {
      content: [
        {
          type: 'text',
          text:
            'Persona: `coder`.\n\n- Contract: ' +
            `\`runtime/logs/workflows/${RUN_ID}/agent/invocations/${invocationId}${suffix}\``,
        },
      ],
    },
  })
}

function turn(...tools: Tool[]): string {
  return JSON.stringify({
    role: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'working' },
        ...tools.map(([name, input]) => ({ type: 'tool_use', name, input })),
      ],
    },
  })
}

function transcript(invocationId: string, turns: string[]): string {
  return `${[opening(invocationId), ...turns].join('\n')}\n`
}

const IMPLEMENT_TURNS = [
  turn(['Read', { path: '/work/src/lib/engine.ts' }]),
  turn(
    ['Read', { path: '/work/src/lib/engine.ts', offset: 10, limit: 40 }],
    ['Shell', { command: 'cd /work && cat src/cli.ts' }],
  ),
  turn([
    'Shell',
    { command: "/work/bin/pan-run -c 'cd /work && rg -n foo src | head'" },
  ]),
  turn(['Write', { path: '/work/runtime/logs/workflows/x/output.json' }]),
  turn(['StrReplace', { path: '/work/src/lib/engine.ts' }]),
  turn([
    'Shell',
    { command: './bin/pan-run -- npm run build && npm run lint' },
  ]),
  turn(['Shell', { command: 'npm test 2>&1' }]),
  turn(['Shell', { command: './bin/pan repository-check fast --run x' }]),
  turn(['Shell', { command: "python3 - <<'EOF'\nprint(1)\nEOF" }]),
  turn(['Shell', { command: 'shasum -a 256 runtime/card.md' }]),
  turn(['Shell', { command: './bin/pan output validate x --invocation y' }]),
  turn(['Read', { path: '/work/src/lib/engine.ts' }]),
]

test('the effective shell command drops cd hops and pan-run wrappers', () => {
  assert.equal(
    effectiveShellCommand('cd /work && ./bin/pan-run -- cat a.ts'),
    'cat a.ts',
  )
  assert.equal(
    effectiveShellCommand(
      "/work/bin/pan-run --label x --quiet -c 'cd /work && sed -n 1,5p a.ts'",
    ),
    'sed -n 1,5p a.ts',
  )
  assert.equal(effectiveShellCommand('bash -lc "ls src"'), 'ls src')
  assert.equal(
    effectiveShellCommand('FOO=1 npm run build && npm run lint'),
    'npm run build && npm run lint',
  )
})

test('shell browsing is decided from the effective command only', () => {
  for (const command of [
    'cat src/cli.ts',
    'cd /work && rg -n foo src | head -5',
    './bin/pan-run -- /usr/bin/grep -n x file',
    "bin/pan-run -c 'wc -l src/lib/engine.ts'",
    'find src -name "*.ts"',
  ]) {
    assert.equal(isShellBrowsingCommand(command), true, command)
  }

  for (const command of [
    'npm run build',
    'git diff --stat',
    './bin/pan-run -- ./bin/pan tests impacted',
    'node -e "console.log(1)" | cat',
  ]) {
    assert.equal(isShellBrowsingCommand(command), false, command)
  }
})

test('unfiltered test output means a direct runner whose output is not bounded', () => {
  assert.equal(isUnfilteredTestCommand('npm test 2>&1'), true)
  assert.equal(isUnfilteredTestCommand('node --test dist/tests/a.js'), true)
  assert.equal(
    isUnfilteredTestCommand('npm run test:unit 2>&1 | tail -40'),
    false,
  )
  assert.equal(isUnfilteredTestCommand('npm test > /tmp/out.log 2>&1'), false)
  assert.equal(
    isUnfilteredTestCommand("./bin/pan-run --quiet -c 'npm test'"),
    false,
  )
  assert.equal(isUnfilteredTestCommand('./bin/pan tests impacted'), false)
})

test('one transcript profile counts turns, reads, shell habits, checks, and paperwork', () => {
  const profile = profileWorkerTranscript(
    transcript(IMPLEMENT_ID, IMPLEMENT_TURNS),
  )

  assert.equal(profile.turns, 12)
  assert.equal(profile.reads, 3)
  assert.equal(profile.partial_reads, 1)
  assert.equal(profile.re_reads, 2)
  assert.deepEqual([...profile.re_read_paths], [['/work/src/lib/engine.ts', 2]])
  assert.equal(profile.shell_calls, 8)
  assert.equal(profile.shell_browsing, 2)
  assert.equal(profile.inline_python, 1)
  assert.equal(profile.unfiltered_test_output, 1)
  assert.deepEqual(Object.fromEntries(profile.self_run_checks), {
    'npm run build': 1,
    'npm run lint': 1,
    'npm test': 1,
    'pan repository-check fast': 1,
  })
  assert.deepEqual(Object.fromEntries(profile.paperwork), {
    digest: 1,
    'pan output validate': 1,
  })
  // The runtime/ output write is paperwork, so the first source edit is the
  // StrReplace on turn 5.
  assert.equal(profile.first_source_edit_turn, 5)
})

test('an invocation id names its stage', () => {
  assert.equal(stageFromInvocationId(IMPLEMENT_ID), 'implement')
  assert.equal(stageFromInvocationId('12_ship-3_abcdef01'), 'ship')
  assert.equal(stageFromInvocationId('not-an-invocation'), null)
})

function writeTranscript(
  transcriptsRoot: string,
  parent: string,
  id: string,
  content: string,
): string {
  const absolute = path.join(
    transcriptsRoot,
    parent,
    'subagents',
    `${id}.jsonl`,
  )

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)

  return absolute
}

test('the profile report groups worker transcripts by stage and emits no content', () => {
  const root = createTestTempDirectory('worker-profile-')
  const transcriptsRoot = path.join(root, 'transcripts')
  const invocations = path.join(
    root,
    'runtime/logs/workflows',
    RUN_ID,
    'agent/invocations',
  )

  mkdirSync(invocations, { recursive: true })
  writeFileSync(path.join(invocations, '..', 'state.json'), '{}\n')
  writeFileSync(
    path.join(invocations, `${IMPLEMENT_ID}.json`),
    JSON.stringify({ stage: { slug: 'implement', persona: 'coder' } }),
  )
  writeTranscript(
    transcriptsRoot,
    'parent-a',
    'worker-a',
    transcript(IMPLEMENT_ID, IMPLEMENT_TURNS),
  )
  // No invocation record: the stage comes from the invocation id.
  writeTranscript(
    transcriptsRoot,
    'parent-a',
    'worker-b',
    transcript(REMEDIATE_ID, [
      turn(['Shell', { command: 'ls src' }]),
      turn(['Edit', { path: 'src/base.ts' }]),
    ]),
  )
  // A supervisor transcript names no invocation and is not a worker.
  mkdirSync(path.join(transcriptsRoot, 'parent-a'), { recursive: true })
  writeFileSync(
    path.join(transcriptsRoot, 'parent-a', 'parent-a.jsonl'),
    `${turn(['Shell', { command: 'cat secret-notes.md' }])}\n`,
  )

  const report = generateWorkerProfileReport(root, {
    days: 7,
    transcriptsRoot,
  })

  assert.equal(report.sources.transcripts_scanned, 3)
  assert.equal(report.sources.workers_profiled, 2)
  assert.deepEqual(
    report.stages.map((stage) => [stage.stage, stage.workers]),
    [
      ['implement', 1],
      ['remediate', 1],
    ],
  )

  const implement = report.stages[0]

  assert.ok(implement)
  assert.deepEqual(implement.personas, ['coder'])
  assert.deepEqual(implement.turns, { total: 12, mean: 12, max: 12 })
  assert.deepEqual(implement.shell, { total: 8, browsing: 2, inline_python: 1 })
  // `npm test` and the `fast` profile are gate-owned suites; the build and
  // lint calls are not.
  assert.deepEqual(implement.suite_calls, { total: 2, per_worker: 2 })
  assert.deepEqual(implement.most_re_read, [
    { path: '(outside workspace)/engine.ts', re_reads: 2 },
  ])
  assert.deepEqual(implement.first_source_edit_turn, {
    workers: 1,
    min: 5,
    mean: 5,
    max: 5,
  })
  assert.equal(report.stages[1]?.first_source_edit_turn?.min, 2)

  const serialized = JSON.stringify(report)

  assert.doesNotMatch(serialized, /working|secret-notes|worker-a|parent-a/u)

  const human = formatWorkerProfileReport(report)

  assert.match(human, /^Worker profile, last 7 days/u)
  assert.match(human, /implement\s+1\s+12/u)
  assert.match(human, /self-run checks: .*npm run build 1/u)
  assert.throws(
    () => generateWorkerProfileReport(root, { days: 0, transcriptsRoot }),
    /--days MUST be an integer from 1 to 365/u,
  )
})

test('the invocation scan matches the stage worker and skips older transcripts', () => {
  const root = createTestTempDirectory('worker-invocation-')
  const transcriptsRoot = path.join(root, 'transcripts')
  const preparedAt = Date.now() - 60_000
  const match = writeTranscript(
    transcriptsRoot,
    'parent',
    'worker',
    transcript(IMPLEMENT_ID, IMPLEMENT_TURNS),
  )

  writeTranscript(
    transcriptsRoot,
    'parent',
    'evidence',
    `${opening(IMPLEMENT_ID, '.qa-brief.md')}\n`,
  )
  writeTranscript(
    transcriptsRoot,
    'parent',
    'other',
    transcript(REMEDIATE_ID, []),
  )

  const stale = writeTranscript(
    transcriptsRoot,
    'old-parent',
    'stale',
    transcript(IMPLEMENT_ID, []),
  )
  const old = new Date(preparedAt - 3_600_000)

  utimesSync(stale, old, old)
  utimesSync(path.dirname(stale), old, old)
  utimesSync(path.dirname(path.dirname(stale)), old, old)

  assert.deepEqual(
    findInvocationTranscripts(transcriptsRoot, IMPLEMENT_ID, preparedAt),
    [match],
  )
})

test('the worker suite cost counts gate profiles and browsing, and is null at zero', () => {
  const root = createTestTempDirectory('worker-suite-cost-')
  const transcriptsRoot = path.join(root, 'transcripts')
  const ledger = path.join(
    root,
    'runtime/logs/workflows',
    RUN_ID,
    'agent/evidence/repository-check-runs.jsonl',
  )
  const previous = process.env[CURSOR_TRANSCRIPTS_ENV]

  mkdirSync(path.dirname(ledger), { recursive: true })
  mkdirSync(transcriptsRoot, { recursive: true })
  writeFileSync(path.join(ledger, '..', '..', 'state.json'), '{}\n')
  process.env[CURSOR_TRANSCRIPTS_ENV] = transcriptsRoot

  try {
    assert.equal(
      workerInvocationSuiteCost(root, RUN_ID, IMPLEMENT_ID, Date.now() - 1_000),
      null,
    )

    writeFileSync(
      ledger,
      [
        { profile: 'fast', invocation_id: IMPLEMENT_ID, invoked_by: 'agent' },
        { profile: 'fast', invocation_id: IMPLEMENT_ID, invoked_by: 'agent' },
        { profile: 'static', invocation_id: IMPLEMENT_ID },
        { profile: 'impacted', invocation_id: IMPLEMENT_ID },
        { profile: 'full', invocation_id: IMPLEMENT_ID, invoked_by: 'harness' },
        { profile: 'fast', invocation_id: REMEDIATE_ID, invoked_by: 'agent' },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n'),
    )

    const withoutTranscript = workerInvocationSuiteCost(
      root,
      RUN_ID,
      IMPLEMENT_ID,
      Date.now() - 1_000,
    )

    // `static` and `impacted` are sanctioned, and the harness row is not the
    // worker's, so only the two `fast` runs count.
    assert.deepEqual(withoutTranscript?.worker_gate_profiles, { fast: 2 })
    assert.equal(withoutTranscript?.shell_browsing_calls, null)
    assert.equal(withoutTranscript?.transcript_found, false)
    assert.match(withoutTranscript?.message ?? '', /unavailable/u)

    writeTranscript(
      transcriptsRoot,
      'parent',
      'worker',
      transcript(IMPLEMENT_ID, IMPLEMENT_TURNS),
    )

    const withTranscript = workerInvocationSuiteCost(
      root,
      RUN_ID,
      IMPLEMENT_ID,
      Date.now() - 60_000,
    )

    assert.equal(withTranscript?.shell_browsing_calls, 2)
    assert.equal(withTranscript?.transcript_found, true)
  } finally {
    if (previous === undefined) {
      delete process.env[CURSOR_TRANSCRIPTS_ENV]
    } else {
      process.env[CURSOR_TRANSCRIPTS_ENV] = previous
    }
  }
})
