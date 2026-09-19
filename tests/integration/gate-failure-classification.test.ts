import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  compareRepositoryCheckToBaseline,
  type RepositoryCheckResult,
} from '../../src/lib/repository-checks.js'
import {
  classifyGateTestFailures,
  evaluateDeterministicCriteria,
} from '../../src/lib/validation.js'
import type {
  Criterion,
  RunState,
  StageDefinition,
  StageOutput,
  WorkspaceSnapshot,
} from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'

const criterion: Criterion = {
  id: 'implement.unit_tests',
  statement: 'Configured fast checks pass.',
  type: 'shell',
  hard: true,
  command: 'pan repository-check fast',
  timeout_ms: 5000,
}

function check(
  root: string,
  status: 'passed' | 'failed',
  diagnostic = '',
): RepositoryCheckResult {
  return {
    profile: 'fast',
    status,
    config_path: 'runtime/repository-checks.json',
    workspace_root: root,
    timeout_ms: 5000,
    results: [
      {
        kind: 'command',
        command: 'npm test',
        exit_code: status === 'passed' ? 0 : 1,
        signal: null,
        stdout: '',
        stderr: diagnostic,
        passed: status === 'passed',
        timed_out: false,
        duration_ms: 1,
      },
    ],
    total_duration_ms: 1,
    advisories: [],
  }
}

function fixture(workspace?: WorkspaceSnapshot): {
  root: string
  workspace: WorkspaceSnapshot
  baseline: RepositoryCheckResult
} {
  const root = createTestTempDirectory(
    'pancreator-gate-failure-classification-',
  )

  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'tests/unit'), { recursive: true })
  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify({ schema_version: 1, installation_mode: 'self_development' })}\n`,
  )
  writeFileSync(path.join(root, 'src/value.ts'), 'export const value = 1\n')
  writeFileSync(
    path.join(root, 'tests/unit/outside.test.ts'),
    "import test from 'node:test'\ntest('outside case', () => {})\n",
  )
  writeFileSync(
    path.join(root, 'tests/unit/inside.test.ts'),
    "import '../../src/value.js'\nimport test from 'node:test'\ntest('inside case', () => {})\n",
  )

  return {
    root,
    workspace: workspace ?? {
      kind: 'git',
      fingerprint: 'candidate',
      entries: [' M src/value.ts'],
    },
    baseline: check(root, 'passed'),
  }
}

/**
 * An isolation stub that records the arguments it received.
 *
 * A stub that ignores `{file}` and `{test}` and returns a constant cannot tell
 * "the failing test re-ran and passed" apart from "the filter matched nothing
 * and the runner exited clean", which is the exact confusion this classifier
 * must not make. Every stub here therefore echoes the test name it was given,
 * in the shape the runner reports an executed test, and appends to a marker so
 * a case can assert how many reruns happened.
 */
function reportingStub(marker: string, exitCode: number): string {
  return (
    `node -e "const fs=require('node:fs');` +
    `fs.appendFileSync('${marker}', process.argv[2] + '\\n');` +
    `console.log('ok 1 - ' + process.argv[2]);` +
    `process.exit(${exitCode})" {file} {test}`
  )
}

/** A stub that exits clean while reporting no test, as a no-match filter does. */
function silentStub(marker: string): string {
  return (
    `node -e "const fs=require('node:fs');` +
    `fs.appendFileSync('${marker}', process.argv[2] + '\\n');` +
    `process.exit(0)" {file} {test}`
  )
}

function markerLines(marker: string): string[] {
  return existsSync(marker)
    ? readFileSync(marker, 'utf8')
        .split('\n')
        .filter((line) => line.length > 0)
    : []
}

function writeChecks(root: string, isolationCommand?: string): void {
  writeFileSync(
    path.join(root, 'runtime/repository-checks.json'),
    `${JSON.stringify({
      schema_version: 1,
      profiles: {
        fast: {
          probes: [],
          commands: ['npm test'],
          ...(isolationCommand ? { isolation_command: isolationCommand } : {}),
        },
      },
    })}\n`,
  )
}

function classify(
  setup: ReturnType<typeof fixture>,
  current: RepositoryCheckResult,
  before?: WorkspaceSnapshot,
) {
  return classifyGateTestFailures({
    root: setup.root,
    workspace: setup.workspace,
    ...(before ? { before } : {}),
    workspaceDir: setup.root,
    profileName: 'fast',
    criterion,
    baseline: setup.baseline,
    current,
    comparison: compareRepositoryCheckToBaseline(setup.baseline, current),
  })
}

test('a gate records and accepts an isolated out-of-closure pass', () => {
  const setup = fixture()
  const baselinePath = 'runtime/baseline-fast.json'
  const runDirectory = path.join(setup.root, 'runtime/run')
  const failureCommand = `node -e "console.error('FAIL tests/unit/outside.test.ts > outside case'); process.exit(1)"`

  mkdirSync(path.join(runDirectory, 'evidence'), { recursive: true })
  writeFileSync(
    path.join(setup.root, baselinePath),
    `${JSON.stringify({
      schema_version: 1,
      run_id: 'run-one',
      stage: 'implement',
      profile: 'fast',
      workspace_fingerprint: 'baseline',
      recorded_at: '2026-09-19T10:00:00.000Z',
      result: setup.baseline,
    })}\n`,
  )
  writeChecks(
    setup.root,
    reportingStub(path.join(setup.root, 'gate-rerun-marker'), 0),
  )
  const checks = JSON.parse(
    readFileSync(
      path.join(setup.root, 'runtime/repository-checks.json'),
      'utf8',
    ),
  ) as { profiles: { fast: { commands: string[] } } }

  checks.profiles.fast.commands = [failureCommand]
  writeFileSync(
    path.join(setup.root, 'runtime/repository-checks.json'),
    `${JSON.stringify(checks)}\n`,
  )

  const state = {
    run_id: 'run-one',
    workspace_root: setup.root,
    state_root: 'runtime',
    stage_history: [],
    gate_overrides: {},
    request: {
      source_path: 'request.md',
      stored_path: 'request.md',
      sha256: 'x',
    },
    repository_check_baselines: {
      fast: {
        profile: 'fast',
        status: 'passed',
        artifact_path: baselinePath,
        workspace_fingerprint: 'baseline',
        recorded_at: '2026-09-19T10:00:00.000Z',
      },
    },
  } as unknown as RunState
  const stage = {
    slug: 'implement',
    name: 'Implementation',
    persona: 'coder',
    workspace_policy: 'source_allowed',
    criteria: [criterion],
  } as unknown as StageDefinition
  const before: WorkspaceSnapshot = {
    kind: 'git',
    fingerprint: 'baseline',
    entries: [],
  }
  const evaluated = evaluateDeterministicCriteria(
    setup.root,
    runDirectory,
    state,
    stage,
    before,
    setup.root,
    {},
    'implement',
    { data: {} } as StageOutput,
    undefined,
    null,
    setup.workspace,
  )
  const result = evaluated.results.find(
    (entry) => entry.id === 'implement.unit_tests',
  )

  assert.ok(result)
  assert.equal(result.passed, true)
  assert.equal(result.exit_code, 1)
  assert.equal(
    result.failure_classifications?.[0]?.disposition,
    'environment_or_flake',
  )
  assert.match(result.explanation ?? '', /failed in the profile.*passed/u)
  assert.match(
    readFileSync(path.join(setup.root, result.evidence_path ?? ''), 'utf8'),
    /failure classifications/u,
  )
})

test('an out-of-closure failure that passes isolation becomes an advisory pass', () => {
  const setup = fixture()
  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(setup.root, reportingStub(marker, 0))
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/outside.test.ts > outside case',
  )
  const repeated = current.results[0]

  assert.ok(repeated)
  current.results.push({ ...repeated, command: 'npm test repeated' })

  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, true)
  assert.match(result.advisory ?? '', /environment_or_flake/u)
  assert.deepEqual(
    result.classifications.map((entry) => entry.disposition),
    ['environment_or_flake'],
  )
  assert.equal(result.classifications.length, 1)
  assert.equal(result.classifications[0]?.isolation_exit_code, 0)
  assert.equal(result.classifications[0]?.isolation_executed, true)
  // One rerun for the duplicated headline, carrying the failing test's name.
  assert.deepEqual(markerLines(marker), ['outside case'])
})

test('an out-of-closure failure that reproduces still fails', () => {
  const setup = fixture()

  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(setup.root, reportingStub(marker, 1))
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/outside.test.ts > outside case',
  )
  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'reproduced')
  assert.equal(result.classifications[0]?.isolation_exit_code, 1)
  assert.deepEqual(markerLines(marker), ['outside case'])
})

test('a failure inside the change closure is never rerun', () => {
  const setup = fixture()
  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(
    setup.root,
    `node -e "require('node:fs').writeFileSync('${marker}', 'yes')" {file} {test}`,
  )
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/inside.test.ts > inside case',
  )
  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'in_change_closure')
  assert.equal(existsSync(marker), false)
})

test('a profile without single-test selection degrades to the original failure', () => {
  const setup = fixture()

  writeChecks(setup.root)
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/outside.test.ts > outside case',
  )
  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'isolation_unavailable')
  assert.equal(result.classifications[0]?.reason, 'no_isolation_command')
})

test('a failure the stage committed stays inside the change closure', () => {
  const committed: WorkspaceSnapshot = {
    kind: 'git',
    fingerprint: 'candidate',
    entries: [],
    commit_content: { 'src/value.ts': 'value-hash' },
  }
  const setup = fixture(committed)
  const before: WorkspaceSnapshot = {
    kind: 'git',
    fingerprint: 'baseline',
    entries: [' M src/value.ts'],
    dirty_content: { 'src/value.ts': 'value-hash' },
  }
  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(setup.root, reportingStub(marker, 0))
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/inside.test.ts > inside case',
  )
  const result = classify(setup, current, before)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'in_change_closure')
  assert.deepEqual(markerLines(marker), [])
})

test('no change evidence at all reclassifies nothing', () => {
  const setup = fixture({
    kind: 'git',
    fingerprint: 'candidate',
    entries: [],
  })
  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(setup.root, reportingStub(marker, 0))
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/inside.test.ts > inside case',
  )
  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'isolation_unavailable')
  assert.equal(result.classifications[0]?.reason, 'no_change_evidence')
  assert.deepEqual(markerLines(marker), [])
})

test('a clean isolation exit that names no test never earns a pass', () => {
  const setup = fixture()
  const marker = path.join(setup.root, 'rerun-marker')

  writeChecks(setup.root, silentStub(marker))
  const current = check(
    setup.root,
    'failed',
    'FAIL tests/unit/outside.test.ts > outside case',
  )
  const result = classify(setup, current)

  assert.equal(result.reclassifiedPass, false)
  assert.equal(result.classifications[0]?.disposition, 'isolation_unproven')
  assert.equal(result.classifications[0]?.isolation_exit_code, 0)
  assert.equal(result.classifications[0]?.isolation_executed, false)
  assert.deepEqual(markerLines(marker), ['outside case'])
})

/**
 * A runnable compiled test file whose case name carries regular-expression
 * syntax. This is the shape that broke the classifier: the runner selects by
 * pattern, so an unescaped `(` opens a capture group, the filter matches
 * nothing, and the runner exits clean with the failing test untouched.
 */
const METACHARACTER_CASE = 'name with (parens) and a.dot'

function writeCompiledTest(root: string, failing: boolean): string {
  const compiled = 'dist/tests/unit/outside.test.js'

  mkdirSync(path.join(root, 'dist/tests/unit'), { recursive: true })
  writeFileSync(
    path.join(root, compiled),
    [
      "import test from 'node:test'",
      "import assert from 'node:assert/strict'",
      '',
      `test(${JSON.stringify(METACHARACTER_CASE)}, () => {`,
      `  assert.equal(1, ${failing ? '2' : '1'})`,
      '})',
      '',
      "test('a sibling case that must not stand in for it', () => {})",
      '',
    ].join('\n'),
  )

  return compiled
}

function nodeIsolationCommand(
  placeholder: '{test_pattern}' | '{test}',
): string {
  return (
    `node --test --test-name-pattern=${placeholder} ` +
    '--test-reporter=tap --test-reporter-destination=stdout {file}'
  )
}

function compiledFailure(root: string): RepositoryCheckResult {
  return check(
    root,
    'failed',
    `FAIL dist/tests/unit/outside.test.js > ${METACHARACTER_CASE}`,
  )
}

test('a real single-test selection reruns the named failing test', () => {
  const setup = fixture()

  writeCompiledTest(setup.root, true)
  writeChecks(setup.root, nodeIsolationCommand('{test_pattern}'))

  const result = classify(setup, compiledFailure(setup.root))
  const classification = result.classifications[0]

  assert.equal(result.reclassifiedPass, false)
  assert.equal(classification?.disposition, 'reproduced')
  assert.equal(classification?.isolation_executed, true)
  assert.match(classification?.isolation_command ?? '', /\\\(parens\\\)/u)
})

test('a real single-test selection accepts a test that passes alone', () => {
  const setup = fixture()

  writeCompiledTest(setup.root, false)
  writeChecks(setup.root, nodeIsolationCommand('{test_pattern}'))

  const result = classify(setup, compiledFailure(setup.root))
  const classification = result.classifications[0]

  assert.equal(result.reclassifiedPass, true)
  assert.equal(classification?.disposition, 'environment_or_flake')
  assert.equal(classification?.isolation_executed, true)
})

test('an unescaped literal name selects no test and earns no pass', () => {
  // The pre-change demonstration for the AC-009 repair, per TP-11. Before it,
  // `{test}` was the only substitution and the exit code was the whole
  // decision, so this input reclassified a genuinely failing test as a flake.
  const setup = fixture()

  writeCompiledTest(setup.root, true)
  writeChecks(setup.root, nodeIsolationCommand('{test}'))

  const result = classify(setup, compiledFailure(setup.root))
  const classification = result.classifications[0]

  assert.equal(classification?.isolation_exit_code, 0)
  assert.equal(classification?.isolation_executed, false)
  assert.equal(classification?.disposition, 'isolation_unproven')
  assert.equal(result.reclassifiedPass, false)
})
