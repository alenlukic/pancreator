import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import {
  BENCHMARK_SESSION_ROOT,
  runBenchmarkSession,
} from '../../src/lib/test-tuning.js'
import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

/**
 * A profile command that writes the suite profile the benchmark reads.
 *
 * `runBenchmarkSession` is the code AC-006 is written about: it captures each
 * side three times and writes the paired record. Only the pure record builder
 * was covered, so the capture, the stability check, and the atomic write were
 * asserted nowhere. This stub stands in for the reporter, which is the one
 * part of the path the benchmark does not own.
 */
function profileWritingCommand(options: {
  population: string[]
  wallClockMs: number
  counter?: string
}): string {
  const script = [
    "const fs = require('node:fs')",
    "const path = require('node:path')",
    'const target = process.env.PAN_TEST_PROFILE',
    ...(options.counter
      ? [
          `const counter = ${JSON.stringify(options.counter)}`,
          "const run = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : '0') + 1",
          'fs.writeFileSync(counter, String(run))',
        ]
      : ['const run = 0']),
    `const population = ${JSON.stringify(options.population)}.map((name, index) => ({ file: 'tests/unit/a.test.ts', name: run > 1 ? name + '-' + run : name, duration_ms: index + 1 }))`,
    "const file = { file: 'tests/unit/a.test.ts', duration_ms: 1, test_count: population.length, pass_count: population.length, fail_count: 0 }",
    `const document = { schema_version: 1, lane: 'unit', recorded_at: new Date().toISOString(), test_count: population.length, pass_count: population.length, fail_count: 0, wall_clock_ms: ${options.wallClockMs}, files: [file], slowest_tests: population, all_tests: population }`,
    'fs.mkdirSync(path.dirname(target), { recursive: true })',
    'fs.writeFileSync(target, JSON.stringify(document))',
  ].join('; ')

  return `node -e ${JSON.stringify(script)}`
}

function writeBenchmarkProfile(root: string, command: string): void {
  const target = path.join(root, 'runtime', 'repository-checks.json')
  const config = JSON.parse(readFileSync(target, 'utf8')) as {
    profiles: Record<string, unknown>
  }

  config.profiles.fast = { probes: [], commands: [command] }
  writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`)
}

function benchmarkFixture(command: string): {
  root: string
  baseline: string
  candidate: string
} {
  const root = createFixture()

  writeBenchmarkProfile(root, command)
  mkdirSync(path.join(root, 'sides/baseline'), { recursive: true })
  mkdirSync(path.join(root, 'sides/candidate'), { recursive: true })

  return { root, baseline: 'sides/baseline', candidate: 'sides/candidate' }
}

test('a benchmark session writes the paired record it compared', () => {
  const fixture = benchmarkFixture(
    profileWritingCommand({
      population: ['a', 'b'],
      wallClockMs: 400,
    }),
  )
  const { record, output_path: outputPath } = runBenchmarkSession({
    root: fixture.root,
    baseline_workspace: fixture.baseline,
    candidate_workspace: fixture.candidate,
    population_tolerance: 0,
  })

  assert.equal(record.comparison.status, 'compared')
  assert.equal(record.baseline?.test_count, 2)
  assert.equal(record.candidate?.test_count, 2)
  assert.deepEqual(record.baseline?.results, ['passed', 'passed', 'passed'])
  assert.deepEqual(record.baseline?.wall_clock_ms, [400, 400, 400])
  assert.equal(record.baseline?.workspace, fixture.baseline)
  assert.equal(record.candidate?.workspace, fixture.candidate)
  assert.ok(record.baseline?.workspace_fingerprint)
  assert.ok(record.candidate?.workspace_fingerprint)

  assert.ok(outputPath.startsWith(BENCHMARK_SESSION_ROOT))

  const written = JSON.parse(
    readFileSync(path.join(fixture.root, outputPath), 'utf8'),
  ) as typeof record

  assert.deepEqual(written, record)

  // The capture removes each run's suite profile, so the session leaves the
  // record and nothing else behind.
  assert.equal(
    existsSync(
      path.join(
        fixture.root,
        BENCHMARK_SESSION_ROOT,
        `${record.session_id}-baseline-1.profile.json`,
      ),
    ),
    false,
  )
})

test('a benchmark session names why a side produced no sample', () => {
  const fixture = benchmarkFixture('node -e "process.exit(0)"')
  const { record } = runBenchmarkSession({
    root: fixture.root,
    baseline_workspace: fixture.baseline,
    candidate_workspace: fixture.candidate,
    population_tolerance: 0,
  })

  assert.equal(record.comparison.status, 'refused')
  assert.match(
    record.comparison.status === 'refused' ? record.comparison.reason : '',
    /0 of 3 baseline runs produced a suite profile/u,
  )
})

test('a benchmark session refuses a side whose population moved', () => {
  const fixture = benchmarkFixture(
    profileWritingCommand({
      population: ['a'],
      wallClockMs: 400,
      counter: 'runs.txt',
    }),
  )
  const { record } = runBenchmarkSession({
    root: fixture.root,
    baseline_workspace: fixture.baseline,
    candidate_workspace: fixture.candidate,
    population_tolerance: 0,
  })

  assert.equal(record.comparison.status, 'refused')
  assert.match(
    record.comparison.status === 'refused' ? record.comparison.reason : '',
    /baseline test population changed between its 3 runs/u,
  )
})

function runBenchmarkCli(root: string, args: string[]) {
  const {
    PANCREATOR_ROOT: _pancreatorRoot,
    PANCREATOR_EXEC_ROOT: _execRoot,
    ...env
  } = process.env

  return spawnSync(process.execPath, [CLI, 'tests', 'benchmark', ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  })
}

test('the benchmark command requires a declared population tolerance', () => {
  const fixture = benchmarkFixture('node -e "process.exit(0)"')
  const refused = runBenchmarkCli(fixture.root, [
    '--baseline-workspace',
    fixture.baseline,
    '--candidate-workspace',
    fixture.candidate,
  ])

  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /--population-tolerance is required/u)
})

test('the benchmark command exits nonzero on a refused comparison', () => {
  const fixture = benchmarkFixture('node -e "process.exit(0)"')
  const refused = runBenchmarkCli(fixture.root, [
    '--baseline-workspace',
    fixture.baseline,
    '--candidate-workspace',
    fixture.candidate,
    '--population-tolerance',
    '0',
  ])

  assert.equal(refused.status, 1)
  assert.match(refused.stdout, /"status": "refused"/u)
})

test('the released profile-timing entry point still parses its flags', () => {
  const help = spawnSync('./bin/benchmark', ['--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  assert.equal(help.status, 0)
  assert.match(help.stdout, /\[--fast\] \[--full\]/u)

  const unknown = spawnSync('./bin/benchmark', ['--population-tolerance'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })

  assert.equal(unknown.status, 2)
  assert.match(unknown.stderr, /unknown option/u)
})
