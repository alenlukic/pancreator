/**
 * `pan tests impacted`: argument parsing, the selected-test run, and its
 * rendered summary.
 */

import { spawn, spawnSync } from 'node:child_process'
import { closeSync, openSync, readFileSync, writeSync } from 'node:fs'
import path from 'node:path'

import {
  checkLogPath,
  checkOutputVerbose,
  formatElapsed,
  parseFailingTests,
  renderFailureDetail,
  runsInsideProfileCommand,
} from '../check-output.js'
import { PanError } from '../errors.js'
import { gitHead } from '../git.js'
import { appendJsonLine, sha256 } from '../io.js'
import { readProjectConfig } from '../project-config.js'
import {
  HARNESS_TESTS_SELF_DEVELOPMENT_ONLY,
  IMPACTED_COMMAND,
  type ImpactOptions,
  type ImpactOutputMode,
  type ImpactResult,
  RECORD_RELATIVE_PATH,
  type RunTestsImpactedOptions,
  SELECTABLE_LANES,
  type Selection,
  TEST_REPORTER_ARGS,
} from './model.js'
import { buildModuleGraph } from './graph.js'
import { selectImpactedTests } from './select.js'
import { resolveChangeSet } from './changes.js'

// --- Command ----------------------------------------------------------------

function distPath(file: string): string {
  return `dist/${file.replace(/\.tsx?$/u, '.js')}`
}

/** Argument vector for the node test run of the selected files. */
export function testCommandArgs(selected: string[]): string[] {
  return ['node', '--test', ...TEST_REPORTER_ARGS, ...selected.map(distPath)]
}

function testRunFailed(error: Error): PanError {
  return new PanError(`Failed to start the test run: ${error.message}`, {
    code: 'TEST_RUN_FAILED',
  })
}

/**
 * Run the selection, returning its exit code.
 *
 * With `logFd`, the child's stdout and stderr both land in that file in the
 * order they were written; `echo` also copies each chunk to this process's
 * streams. Without it the child inherits this process's streams.
 */
async function runSelected(
  root: string,
  selected: string[],
  logFd: number | null = null,
  echo = false,
): Promise<number> {
  const runBuilt = path.join(root, 'bin', 'run-built')
  // run-tests gives the selection its own scratch directory under the root
  // and removes it afterwards, the same as every npm test script.
  const runTests = path.join(root, 'bin', 'run-tests')
  const args = ['--', runTests, '--', ...testCommandArgs(selected)]

  if (logFd === null || !echo) {
    const result = spawnSync(runBuilt, args, {
      cwd: root,
      stdio: logFd === null ? 'inherit' : ['ignore', logFd, logFd],
    })

    if (result.error) {
      throw testRunFailed(result.error)
    }

    return result.status ?? 1
  }

  return await new Promise<number>((resolve, reject) => {
    const child = spawn(runBuilt, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const tee =
      (stream: NodeJS.WriteStream) =>
      (chunk: Buffer): void => {
        writeSync(logFd, chunk)
        stream.write(chunk)
      }

    child.stdout.on('data', tee(process.stdout))
    child.stderr.on('data', tee(process.stderr))
    child.on('error', (error) => reject(testRunFailed(error)))
    child.on('close', (code) => resolve(code ?? 1))
  })
}

/** The run's own `# tests <n>` count, or null when the output carries none. */
function reportedTestCount(output: string): number | null {
  const counts = [...output.matchAll(/^# tests (\d+)$/gmu)]
  const last = counts.at(-1)

  return last ? Number(last[1]) : null
}

/**
 * The compact report of a selection that ran: one pass line, or the failing
 * tests (or the output tail) with the log path, plus the unreached files and
 * the advisory a caller still has to act on.
 */
function renderRunSummary(result: ImpactResult, output: string): string {
  const tag = '[tests impacted]'
  const selection = `${result.selected_count} of ${result.lane_count} lane test file(s)`
  const elapsed = formatElapsed(result.duration_ms)
  const lines: string[] = []

  if (result.workspace !== '.') {
    lines.push(`Workspace: ${result.workspace}`)
  }

  if (result.exit_code === 0) {
    const tests = reportedTestCount(output)

    lines.push(
      `${tag} passed: ${selection}${tests === null ? '' : `, ${tests} tests`} in ${elapsed}` +
        (result.log_path ? ` (log: ${result.log_path})` : ''),
    )
  } else {
    lines.push(
      `${tag} FAILED: ${selection} (exit ${result.exit_code}) in ${elapsed}`,
    )
    lines.push(...renderFailureDetail(output, result.failing_tests ?? []))

    if (result.log_path) {
      lines.push(`log: ${result.log_path}`)
    }
  }

  if (result.unreached.length > 0) {
    lines.push('Changed files no lane test reaches:')
    lines.push(
      ...result.unreached.map((file) => describeUnreached(result, file)),
    )
  }

  if (result.advisory) {
    lines.push(`Advisory: ${result.advisory}`)
  }

  return lines.join('\n')
}

function resolveOutputMode(
  args: string[],
  options: RunTestsImpactedOptions,
): ImpactOutputMode {
  if (options.output) {
    return options.output
  }

  if (checkOutputVerbose(args)) {
    return 'verbose'
  }

  return runsInsideProfileCommand() ? 'passthrough' : 'summary'
}

function readNumberOption(value: string | null, name: string): number | null {
  if (value === null) {
    return null
  }

  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new PanError(`${name} must be a number between 0 and 1.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return parsed
}

/** Parse `pan tests impacted` arguments. */
export function parseImpactArgs(args: string[]): ImpactOptions {
  const options: ImpactOptions = { files: [], include: [] }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    const valueOf = (): string => {
      const value = args[index + 1]

      if (!value || value.startsWith('--')) {
        throw new PanError(`${arg} requires a value.`, {
          code: 'INVALID_ARGUMENT',
        })
      }

      index += 1

      return value
    }

    switch (arg) {
      case '--changed':
        options.changed = valueOf()
        break
      case '--staged':
        options.staged = true
        break
      case '--worktree-dirty':
        options.worktreeDirty = true
        break
      case '--file':
        options.files?.push(valueOf().replace(/^\.\//u, ''))
        break
      case '--include':
        options.include?.push(valueOf())
        break
      case '--list':
        options.list = true
        break
      case '--json':
        options.json = true
        break
      case '--verbose':
        options.verbose = true
        break
      case '--depth': {
        const depth = Number(valueOf())

        if (!Number.isInteger(depth) || depth < 1) {
          throw new PanError('--depth must be a positive integer.', {
            code: 'INVALID_ARGUMENT',
          })
        }

        options.depth = depth
        break
      }
      case '--advisory-ratio':
        options.advisoryRatio =
          readNumberOption(valueOf(), '--advisory-ratio') ?? undefined
        break
      case '--lane': {
        const name = valueOf()
        const lane = SELECTABLE_LANES[name]

        if (!lane) {
          throw new PanError(
            `--lane must be one of: ${Object.keys(SELECTABLE_LANES).join(', ')}.`,
            { code: 'INVALID_ARGUMENT' },
          )
        }

        options.lanes = [...new Set([...(options.lanes ?? []), lane])]
        break
      }
      case '--worktree':
        // The CLI resolves the named worktree to a workspace path through the
        // shared option, so the selection only has to accept the spelling.
        valueOf()
        break
      default:
        throw new PanError(`Unknown option for tests impacted: ${arg}`, {
          code: 'INVALID_ARGUMENT',
        })
    }
  }

  if (options.staged && options.changed) {
    throw new PanError('--staged and --changed are mutually exclusive.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  return options
}

function describeUnreached(result: Selection, file: string): string {
  return result.type_only.includes(file)
    ? `  ${file}  (type-only imports; the build verifies it)`
    : `  ${file}`
}

function renderText(result: ImpactResult): string {
  const lines: string[] = []

  if (result.workspace !== '.') {
    lines.push(`Workspace: ${result.workspace}`)
  }

  if (result.status === 'nothing_changed') {
    lines.push('No changed files. No test selected.')
  } else if (result.status === 'no_tests_reached') {
    lines.push(
      `No lane test reaches the ${result.changed.length} changed file(s). Add a test for the change.`,
    )
    lines.push(...result.changed.map((file) => describeUnreached(result, file)))
  } else {
    lines.push(
      `Selected ${result.selected_count} of ${result.lane_count} lane tests for ${result.changed.length} changed file(s).`,
    )
    lines.push(
      ...result.selected.map(
        (test) =>
          `  ${test}  <- ${result.reasons[test] ?? ''} (depth ${result.depths[test] ?? 0})`,
      ),
    )
    lines.push(
      `By depth: ${Object.entries(result.by_depth)
        .map(([depth, count]) => `${depth}:${count}`)
        .join(' ')}` +
        (result.depth_limit === null ? '' : ` (limit ${result.depth_limit})`),
    )

    if (result.unreached.length > 0) {
      lines.push('Changed files no lane test reaches:')
      lines.push(
        ...result.unreached.map((file) => describeUnreached(result, file)),
      )
    }
  }

  if (result.advisory) {
    lines.push(`Advisory: ${result.advisory}`)
  }

  lines.push(
    `Graph: ${result.parser} parser, ${result.graph_build_ms} ms. Total ${result.duration_ms} ms.`,
  )

  return lines.join('\n')
}

/**
 * Run `pan tests impacted`.
 *
 * Writes the result to `write`, appends one record to the impact ledger, and
 * returns the process exit code the caller sets.
 */
export async function runTestsImpacted(
  root: string,
  args: string[],
  options: RunTestsImpactedOptions = {},
): Promise<ImpactResult> {
  const write = options.write ?? ((text: string) => process.stdout.write(text))
  const workspace = options.workspace ?? root
  const mode = readProjectConfig(root)?.installation_mode

  if (mode === 'embedded' || mode === 'detached') {
    throw new PanError(HARNESS_TESTS_SELF_DEVELOPMENT_ONLY, {
      code: 'HARNESS_TESTS_SELF_DEVELOPMENT_ONLY',
    })
  }

  const started = performance.now()
  const impactOptions = parseImpactArgs(args)

  const graph = await buildModuleGraph(workspace)
  const changed = resolveChangeSet(workspace, impactOptions)
  const selection = selectImpactedTests(graph, changed, {
    include: impactOptions.include,
    advisoryRatio: impactOptions.advisoryRatio,
    depth: impactOptions.depth,
    ...(impactOptions.lanes ? { lanes: impactOptions.lanes } : {}),
  })

  // The record stays at the installation root so one history covers every
  // workspace the operator selected from it.
  const recordPath = path.join(root, RECORD_RELATIVE_PATH)
  const workspaceLabel = workspaceRelativeLabel(root, workspace)

  let status: ImpactResult['status']
  let exitCode = 0
  const outputMode = resolveOutputMode(args, options)
  let log: { absolute: string; relative: string } | null = null
  let output = ''

  if (changed.length === 0 && selection.selected_count === 0) {
    status = 'nothing_changed'
  } else if (selection.selected_count === 0) {
    status = 'no_tests_reached'
  } else if (impactOptions.list) {
    status = 'listed'
  } else {
    status = 'ran'

    if (outputMode === 'passthrough') {
      exitCode = await runSelected(workspace, selection.selected)
    } else {
      // The complete transcript goes to a log so the summary can stay short
      // and still name where every line of a failure is.
      log = checkLogPath(root, 'tests-impacted')
      const progress =
        options.progress ?? ((text: string) => void process.stderr.write(text))

      progress(
        `[tests impacted] running ${selection.selected_count} of ` +
          `${selection.lane_count} lane test file(s) for ` +
          `${selection.changed.length} changed file(s) (log: ${log.relative})\n`,
      )

      const logFd = openSync(log.absolute, 'w')

      try {
        writeSync(
          logFd,
          `$ ${IMPACTED_COMMAND} ${args.join(' ')}`.trimEnd() +
            `\nworkspace=${workspaceLabel}\n` +
            `selected=${selection.selected.join(' ')}\n\n`,
        )
        exitCode = await runSelected(
          workspace,
          selection.selected,
          logFd,
          outputMode === 'verbose',
        )
      } finally {
        closeSync(logFd)
      }

      output = readFileSync(log.absolute, 'utf8')
    }
  }

  const result: ImpactResult = {
    status,
    ...selection,
    graph_build_ms: graph.build_ms,
    parser: graph.parser,
    exit_code: exitCode,
    duration_ms: Math.round(performance.now() - started),
    record_path: RECORD_RELATIVE_PATH,
    workspace: workspaceLabel,
    ...(status === 'ran'
      ? {
          log_path: log?.relative ?? null,
          failing_tests:
            exitCode === 0 ? [] : parseFailingTests(output, workspace),
        }
      : {}),
  }

  appendJsonLine(recordPath, {
    timestamp: new Date().toISOString(),
    fingerprint: sha256({
      head: gitHead(workspace),
      changed: selection.changed,
    }),
    workspace: workspaceLabel,
    status,
    changed_count: selection.changed.length,
    selected_count: selection.selected_count,
    lane_count: selection.lane_count,
    ...(impactOptions.lanes ? { lanes: impactOptions.lanes } : {}),
    ratio: selection.ratio,
    advisory: selection.advisory !== null,
    graph_build_ms: graph.build_ms,
    duration_ms: result.duration_ms,
    result: status === 'ran' ? (exitCode === 0 ? 'pass' : 'fail') : 'none',
  })

  // A run that logged its output reports compactly; the full selection
  // listing stays with `--list`, `--verbose`, and the passthrough a profile
  // runner captures.
  const text =
    status === 'ran' && outputMode !== 'passthrough'
      ? outputMode === 'verbose'
        ? `${renderText(result)}\n${renderRunSummary(result, output)}`
        : renderRunSummary(result, output)
      : renderText(result)

  write(
    impactOptions.json ? `${JSON.stringify(result, null, 2)}\n` : `${text}\n`,
  )

  return result
}

/** `.` for the installation root, otherwise the workspace's relative path. */
function workspaceRelativeLabel(root: string, workspace: string): string {
  const relative = path.relative(root, workspace)

  return relative === '' ? '.' : relative.split(path.sep).join('/')
}
