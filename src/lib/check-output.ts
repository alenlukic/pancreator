/**
 * Compact reporting for the sanctioned check wrappers.
 *
 * `pan repository-check` and `pan tests impacted` keep a suite's full output
 * in a log file and print only a pass line, or the failing command and the
 * failing tests with that log's path. A worker that reads the summary spends
 * a few lines of context on a green run instead of the whole transcript, and
 * the log still holds every byte for the failure it has to diagnose.
 *
 * This module deliberately imports nothing heavier than `io.ts` and
 * `naming.ts`, because `test-impact.ts` keeps its import closure narrow.
 */
import { randomBytes } from 'node:crypto'
import path from 'node:path'

import { ensureDir, writeTextAtomic } from './io.js'
import { temporalNamePrefix } from './naming.js'
import type {
  RepositoryCheckCommandResult,
  RepositoryCheckResult,
} from './repository-checks/config.js'

/** Installation-relative directory holding one full-output log per execution. */
export const CHECK_LOG_DIRECTORY = 'runtime/logs/repository-check'

/**
 * Set on every repository-check profile command. A wrapper that sees it runs
 * inside a runner that already captures, logs, and summarizes its output, so
 * it passes its own output through unchanged instead of summarizing twice.
 * Gate evidence and baseline diagnostics therefore keep the transcript they
 * always had.
 */
export const PROFILE_COMMAND_ENV = 'PAN_REPOSITORY_CHECK_PROFILE'

/** The operator's opt-in to streamed output, which `bin/pan-run` also honors. */
export const VERBOSE_ENV = 'PAN_VERBOSE'

/** Output lines shown for a failure whose output names no test. */
export const FAILURE_TAIL_LINES = 40

/** Failing tests printed per command; the log and `--json` carry the rest. */
export const FAILING_TEST_DISPLAY_LIMIT = 30

/** Failing tests a JSON result carries per command. */
const FAILING_TEST_RECORD_LIMIT = 200

export interface FailingTest {
  name: string
  /** `file:line` as the reporter named it, workspace-relative when inside. */
  location: string | null
}

/** Failing tests of one failed probe or command. */
export interface FailingCommandTests {
  kind: RepositoryCheckCommandResult['kind']
  command: string
  failing_tests: FailingTest[]
}

/** Whether `--verbose` or `PAN_VERBOSE` asks for streamed output. */
export function checkOutputVerbose(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    args.includes('--verbose') ||
    /^(?:1|true|yes)$/iu.test(env[VERBOSE_ENV] ?? '')
  )
}

/** Whether this process is itself a repository-check profile command. */
export function runsInsideProfileCommand(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (env[PROFILE_COMMAND_ENV] ?? '').length > 0
}

/**
 * A fresh log path for one execution. The name carries the shared temporal
 * prefix, so it sorts with every other runtime record and the diagnostic
 * normalizer folds it to one identity across runs.
 */
export function checkLogPath(
  root: string,
  label: string,
  at = new Date(),
): { absolute: string; relative: string } {
  const safeLabel =
    label.toLowerCase().replaceAll(/[^a-z0-9_-]+/gu, '-') || 'check'
  const relative = `${CHECK_LOG_DIRECTORY}/${temporalNamePrefix(at)}_${safeLabel}-${randomBytes(4).toString('hex')}.log`
  const absolute = path.join(root, relative)

  ensureDir(path.dirname(absolute))

  return { absolute, relative }
}

function normalizeLocation(location: string, workspaceRoot: string): string {
  const withoutScheme = location.replace(/^file:\/\//u, '')

  if (!path.isAbsolute(withoutScheme)) {
    return withoutScheme
  }

  const relative = path.relative(workspaceRoot, withoutScheme)

  return relative.startsWith('..') || path.isAbsolute(relative)
    ? withoutScheme
    : relative.split(path.sep).join('/')
}

/** A parent failure whose only error is that a child already failed. */
function isSubtestRollup(error: string): boolean {
  return /\b\d+ subtests? failed\b/u.test(error)
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

/**
 * Failing tests named in a node:test transcript.
 *
 * Three shapes are recognized: the repository's `failures-only` reporter
 * (`not ok - <name> (<file>:<line>)`), TAP (`not ok <n> - <name>` with a
 * `location:` line), and the spec reporter's closing `failing tests:` block.
 * A suite or parent test that failed only because a child did is dropped, so
 * each failure is listed once at the test that owns it.
 */
export function parseFailingTests(
  output: string,
  workspaceRoot = process.cwd(),
): FailingTest[] {
  const lines = stripAnsi(output).split(/\r?\n/u)
  const found: FailingTest[] = []
  const seen = new Set<string>()
  const add = (name: string, location: string | null): void => {
    const entry = {
      name: name.trim(),
      location: location ? normalizeLocation(location, workspaceRoot) : null,
    }
    const key = `${entry.name}\u0000${entry.location ?? ''}`

    if (entry.name.length > 0 && !seen.has(key)) {
      seen.add(key)
      found.push(entry)
    }
  }
  const nextContent = (from: number): string => {
    for (let index = from; index < lines.length; index += 1) {
      const line = (lines[index] as string).trim()

      if (line.length > 0) {
        return line
      }
    }

    return ''
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string

    const failuresOnly = /^not ok - (.+?)(?: \(([^()]+:\d+)\))?$/u.exec(line)

    if (failuresOnly) {
      if (!isSubtestRollup(nextContent(index + 1))) {
        add(failuresOnly[1] as string, failuresOnly[2] ?? null)
      }
      continue
    }

    const tap = /^(\s*)not ok \d+ - (.+?)(?:\s+#\s.*)?$/u.exec(line)

    if (tap) {
      const indent = (tap[1] as string).length
      let location: string | null = null
      let rollup = false

      for (let inner = index + 1; inner < lines.length; inner += 1) {
        const detail = lines[inner] as string
        const detailIndent = detail.length - detail.trimStart().length

        if (detail.trim().length > 0 && detailIndent <= indent) {
          break
        }

        const locationMatch = /^\s*location: '(.+)'$/u.exec(detail)

        if (locationMatch && location === null) {
          location = (locationMatch[1] as string).replace(/:\d+$/u, '')
        }

        if (/^\s*error: '\d+ subtests? failed'$/u.test(detail)) {
          rollup = true
        }

        // A child's block starts inside this one; its details are its own.
        if (/^\s*not ok \d+ - /u.test(detail)) {
          break
        }
      }

      if (!rollup) {
        add(tap[2] as string, location)
      }
      continue
    }

    const specLocation = /^test at (\S+)$/u.exec(line)

    if (specLocation) {
      const spec = /^✖ (.+?) \([\d.]+m?s\)$/u.exec(nextContent(index + 1))

      if (spec) {
        add(
          spec[1] as string,
          (specLocation[1] as string).replace(/:\d+$/u, ''),
        )
      }
    }
  }

  return found
}

/** The last `count` lines of `output`, trailing blank lines dropped. */
export function outputTail(
  output: string,
  count = FAILURE_TAIL_LINES,
): string[] {
  const lines = stripAnsi(output).replace(/\s+$/u, '').split(/\r?\n/u)

  return lines.length === 1 && lines[0] === '' ? [] : lines.slice(-count)
}

/** Seconds with one decimal, the resolution a wait is read at. */
export function formatElapsed(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function describeTest(test: FailingTest): string {
  return test.location ? `${test.name} (${test.location})` : test.name
}

/**
 * The indented failing-test list, or the output tail when no test identity
 * parses, for one failed command's captured output.
 */
export function renderFailureDetail(
  output: string,
  failingTests: FailingTest[],
): string[] {
  if (failingTests.length > 0) {
    const shown = failingTests.slice(0, FAILING_TEST_DISPLAY_LIMIT)
    const lines = [
      `  failing tests (${failingTests.length}):`,
      ...shown.map((test) => `    ${describeTest(test)}`),
    ]

    if (failingTests.length > shown.length) {
      lines.push(`    … ${failingTests.length - shown.length} more in the log`)
    }

    return lines
  }

  const tail = outputTail(output)

  return tail.length > 0
    ? [
        `  last ${tail.length} output lines:`,
        ...tail.map((line) => `    ${line}`),
      ]
    : ['  (no output)']
}

function entryOutput(entry: RepositoryCheckCommandResult): string {
  return [entry.stdout, entry.stderr, entry.error ?? '']
    .map((part) => part.replace(/\n$/u, ''))
    .filter((part) => part.length > 0)
    .join('\n')
}

/** Failing tests of every failed entry in a profile result. */
export function repositoryCheckFailingTests(
  result: RepositoryCheckResult,
): FailingCommandTests[] {
  return result.results
    .filter((entry) => !entry.passed)
    .map((entry) => ({
      kind: entry.kind,
      command: entry.command,
      failing_tests: parseFailingTests(
        entryOutput(entry),
        result.workspace_root,
      ).slice(0, FAILING_TEST_RECORD_LIMIT),
    }))
}

function describeExit(entry: RepositoryCheckCommandResult): string {
  if (entry.timed_out) {
    return 'timed out'
  }

  if (entry.signal) {
    return `signal ${entry.signal}`
  }

  return entry.exit_code === null
    ? (entry.error ?? 'did not start')
    : `exit ${entry.exit_code}`
}

function streamLines(value: string): string[] {
  return value.length === 0 ? [] : [value.replace(/\n$/u, '')]
}

/**
 * Write every entry's complete captured output to one log and return its
 * installation-relative path. The log is plain text in declared order, so a
 * reader finds a failing command's transcript without the JSON envelope.
 */
export function writeRepositoryCheckLog(
  root: string,
  result: RepositoryCheckResult,
  startedAt: string,
  command: string,
): string {
  const log = checkLogPath(root, result.profile)
  const sections = result.results.map((entry, index) =>
    [
      `=== ${entry.kind} ${index + 1}/${result.results.length}: ${entry.command} ===`,
      `exit_code=${entry.exit_code ?? 'null'} signal=${entry.signal ?? 'null'} ` +
        `timed_out=${entry.timed_out} duration_ms=${entry.duration_ms}`,
      ...(entry.error ? [`error=${entry.error}`] : []),
      '--- stdout ---',
      ...streamLines(entry.stdout),
      '--- stderr ---',
      ...streamLines(entry.stderr),
      '',
    ].join('\n'),
  )

  writeTextAtomic(
    log.absolute,
    [
      `$ ${command}`,
      `profile=${result.profile}`,
      `status=${result.status}`,
      `workspace_root=${result.workspace_root}`,
      `started_at=${startedAt}`,
      `finished_at=${new Date().toISOString()}`,
      `total_duration_ms=${result.total_duration_ms}`,
      '',
      ...sections,
    ].join('\n'),
  )

  return log.relative
}

/**
 * The text a bare `pan repository-check <profile>` prints when it finishes:
 * one pass line, or each failed entry with its failing tests (or its output
 * tail) followed by the log path.
 */
export function renderRepositoryCheckSummary(
  result: RepositoryCheckResult,
  logPath: string | null,
): string {
  const tag = `[repository-check:${result.profile}]`

  if (result.status === 'not_configured') {
    return `${tag} not configured: the profile declares no commands.`
  }

  const commands = result.results.filter((entry) => entry.kind === 'command')
  const elapsed = formatElapsed(result.total_duration_ms)
  const logSuffix = logPath ? ` (log: ${logPath})` : ''

  if (result.status === 'passed') {
    return `${tag} passed: ${plural(commands.length, 'command')} in ${elapsed}${logSuffix}`
  }

  const failed = result.results.filter((entry) => !entry.passed)
  const failedCommands = failed.filter((entry) => entry.kind === 'command')
  const headline =
    failedCommands.length > 0
      ? `${failedCommands.length} of ${plural(commands.length, 'command')} failed`
      : 'a probe failed'
  const lines = [`${tag} FAILED: ${headline} in ${elapsed}`]

  for (const entry of failed) {
    const output = entryOutput(entry)

    lines.push(
      `failed ${entry.kind}: ${entry.command} (${describeExit(entry)})`,
    )
    lines.push(
      ...renderFailureDetail(
        output,
        parseFailingTests(output, result.workspace_root),
      ),
    )
  }

  if (logPath) {
    lines.push(`log: ${logPath}`)
  }

  return lines.join('\n')
}
