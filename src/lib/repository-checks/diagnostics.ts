import path from 'node:path'
import { DEFAULT_TEST_SCRATCH_PATH, testScratchRoot } from '../test-scratch.js'
import type { RepositoryCheckDiagnostic } from '../types.js'
import type {
  RepositoryCheckCommandResult,
  RepositoryCheckResult,
} from './config.js'

/**
 * Head and tail bytes preserved per captured stream when a result is summarized
 * for agent-facing reading. A failing check's actionable content sits at both
 * ends: the first diagnostics and the closing summary line.
 */
export const SUMMARY_STREAM_HEAD_BYTES = 24 * 1024

export const SUMMARY_STREAM_TAIL_BYTES = 8 * 1024

function elideStream(value: string): string {
  const budget = SUMMARY_STREAM_HEAD_BYTES + SUMMARY_STREAM_TAIL_BYTES

  if (value.length <= budget) {
    return value
  }

  const elided = value.length - budget

  return [
    value.slice(0, SUMMARY_STREAM_HEAD_BYTES),
    `\n…[${elided} bytes elided; see the full result artifact]…\n`,
    value.slice(value.length - SUMMARY_STREAM_TAIL_BYTES),
  ].join('')
}

/**
 * Bound a result's captured output for artifacts an agent is required to read.
 * A multi-megabyte transcript promoted to required reading crowds out the
 * invocation contract it is supposed to support.
 */
export function summarizeRepositoryCheckResult(result: RepositoryCheckResult): {
  summary: RepositoryCheckResult
  elided: boolean
} {
  let elided = false
  const results = result.results.map((entry) => {
    const stdout = elideStream(entry.stdout)
    const stderr = elideStream(entry.stderr)

    if (stdout !== entry.stdout || stderr !== entry.stderr) {
      elided = true
    }

    return { ...entry, stdout, stderr }
  })

  return { summary: { ...result, results }, elided }
}

export function repositoryCheckProfileName(command: string): string | null {
  const match = /^pan repository-check ([a-z0-9][a-z0-9_-]*)$/u.exec(
    command.trim(),
  )

  return match?.[1] ?? null
}

function stripAnsi(value: string): string {
  return value.replaceAll(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}

function isVolatileSummaryLine(line: string): boolean {
  return (
    /^(?:✖\s*)?\d+\s+problems?(?:\s+\(|$)/iu.test(line) ||
    /^(?:tests?|test suites?|snapshots?|time):/iu.test(line) ||
    /^#\s+(?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/iu.test(
      line,
    ) ||
    /^=+\s+.*\b(?:failed|passed|error|errors)\b.*=+$/iu.test(line) ||
    // A pytest warnings-summary attribution line counts warnings per file, and
    // the file a warning attaches to shifts with xdist scheduling.
    /^\S+: \d+ warnings?$/iu.test(line)
  )
}

/**
 * The workspace's test scratch root when configuration moves it outside the
 * workspace, or null. Each worktree resolves its own child of a configured
 * root, so diagnostics fold it back to the in-workspace default.
 */
function externalTestScratchRoot(workspaceRoot: string): string | null {
  let scratch: string

  try {
    scratch = testScratchRoot(workspaceRoot)
  } catch {
    return null
  }

  return scratch === path.join(workspaceRoot, DEFAULT_TEST_SCRATCH_PATH)
    ? null
    : scratch
}

function normalizeDiagnosticLine(
  line: string,
  workspaceRoot: string,
  externalScratch: string | null,
): string {
  const slashed = stripAnsi(line).replaceAll('\\', '/')
  const unscratched = externalScratch
    ? slashed.replaceAll(
        externalScratch.replaceAll('\\', '/'),
        '<workspace>/runtime/tmp/tests.noindex',
      )
    : slashed

  return (
    unscratched
      .replaceAll(workspaceRoot.replaceAll('\\', '/'), '<workspace>')
      // Test scratch trees carry per-run random segments (the suite run
      // directory and the fixture directory), and harness run or session ids
      // embed a volatile temporal prefix. Neither is ever the failure signal,
      // and keeping either would report every pre-existing environment
      // failure as new on every run.
      .replaceAll(
        /runtime\/tmp\/tests\.noindex\/(?:[^\s/'"]+\/){2}/gu,
        'runtime/tmp/tests.noindex/<scratch>/',
      )
      .replaceAll(
        /\b\d+_(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}-\d{4}_[\w-]+/gu,
        '<run-id>',
      )
      // pytest-xdist prefixes depend on worker scheduling and collection order.
      // Remove each prefix so two equivalent runs produce the same identity.
      .replaceAll(/^(?:\[(?:gw\d+|\s*\d+%)\]\s*)+/giu, '')
      .replaceAll(
        /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu,
        '<timestamp>',
      )
      .replaceAll(
        /\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min|mins|minutes)\b/giu,
        '<duration>',
      )
      // A TAP index shifts whenever a suite gains or loses a case, so keeping it
      // would report every surviving failure as both fixed and new.
      .replaceAll(/^((?:not )?ok)\s+\d+\b/giu, '$1 <index>')
      .replaceAll(/([/\w.-]+):\d+:\d+/gu, '$1:<line>:<column>')
      .replaceAll(/([/\w.-]+):\d+/gu, '$1:<line>')
      .replaceAll(/\s+/gu, ' ')
      .trim()
  )
}

/**
 * Synthetic diagnostic recording how a command failed rather than what it
 * printed. A changed exit code, signal, or timeout is a different failure even
 * when the captured text is identical, so the identity has to participate in the
 * delta.
 */
function statusIdentityDiagnostic(
  result: RepositoryCheckCommandResult,
): string {
  return (
    `<status> exit_code=${result.exit_code ?? 'null'} ` +
    `signal=${result.signal ?? 'null'} timed_out=${result.timed_out}`
  )
}

function isNonFailureOutputLine(line: string): boolean {
  return (
    line.length === 0 ||
    /^(?:(?:\S+(?:::\S+)+\s+)?PASSED|PASSED\s+\S+(?:::\S+)+)(?:\s+\[[^\]]+\])?$/iu.test(
      line,
    ) ||
    // Verbose pytest pass lines whose node id carries bracketed parameters with
    // spaces, or whose tail carries interleaved log output from another worker.
    /^(?:PASSED|XPASS) \S+::.*$/u.test(line) ||
    /^\S+::.* (?:PASSED|XPASS)\b.*$/u.test(line) ||
    // A bare pytest node id is a progress echo, or a warnings-summary header.
    /^[\w./-]+(?:::[\w.-]+)+(?:\[.*\])?$/u.test(line) ||
    /^(?:ok \d+\b|# Subtest:|TAP version \d+\b)/iu.test(line) ||
    // TAP YAML block delimiters are exactly three characters; a longer line
    // starting with `---` can be real failure content (a diff header).
    /^(?:---|\.\.\.)$/u.test(line) ||
    /^(?:type: ['"]test['"]|duration_ms:)/iu.test(line) ||
    /^(?:=+\s*$|=+ .* =+$)/iu.test(line) ||
    /^\[(?:gw\d+|\s*\d+%)\](?:\s+\[(?:gw\d+|\s*\d+%)\])*$/iu.test(line)
  )
}

/**
 * pytest session-header noise. Scoped to transcripts that look like pytest:
 * applied globally, prefixes like `platform`, `collecting`, or `timeout:`
 * would swallow genuine failure text from other tools (a GNU timeout error,
 * a platform-support error).
 */
function isPytestSessionNoiseLine(line: string): boolean {
  return (
    /^(?:platform|plugins:|rootdir:|configfile:|collecting\b|collected \d+)/iu.test(
      line,
    ) ||
    /^(?:cachedir:|timeout(?: method| func_only)?:|asyncio:|hypothesis profile\b)/iu.test(
      line,
    ) ||
    /^(?:created: \d+\/\d+ workers?|\d+ workers \[\d+ items?\]|scheduling tests via )/iu.test(
      line,
    ) ||
    /^(?:test session starts|-- Docs:)/iu.test(line)
  )
}

function isPytestTranscript(lines: string[]): boolean {
  return lines.some(
    (line) =>
      /^test session starts\b/iu.test(line) ||
      /^plugins:/iu.test(line) ||
      /^rootdir:/iu.test(line) ||
      /(?:^|\s)pytest(?:-|\s|$)/iu.test(line),
  )
}

function isPytestFailureLine(line: string): boolean {
  return (
    // Node ids carry bracketed parameters that may contain spaces, so the
    // portion after `::` (or after the ` - ` of a collection error) is matched
    // loosely; `\S+(?:::\S+)+` alone missed `FAILED x.py::test[ True ]`.
    /^(?:FAILED|ERROR)\s+\S+(?:::.*|\s+-\s+.*)?$/u.test(line) ||
    /^\S+::.*\s(?:FAILED|ERROR)(?:\s+\[\s*\d+%\])?$/u.test(line) ||
    /^_+\s+ERROR collecting\s+.+\s+_+$/iu.test(line) ||
    /^(?:E\s+)?(?:ImportError|ModuleNotFoundError)\b/u.test(line) ||
    /\b(?:ETIMEDOUT|timed out|worker.*(?:crash|exit))\b/iu.test(line)
  )
}

function diagnosticCounts(
  result: RepositoryCheckCommandResult,
  workspaceRoot: string,
): Map<string, number> {
  const externalScratch = externalTestScratchRoot(workspaceRoot)
  const normalizedLines =
    `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`
      .split(/\r?\n/u)
      .map((line) =>
        normalizeDiagnosticLine(line, workspaceRoot, externalScratch),
      )
  // A recognized failure line is kept unconditionally: pass-echo and noise
  // patterns run first, and a failure record that also mentions PASSED (xdist
  // interleaving) must not be filtered before the failure allowlist sees it.
  const lines = normalizedLines.filter(
    (line) =>
      isPytestFailureLine(line) ||
      (!isNonFailureOutputLine(line) && !isVolatileSummaryLine(line)),
  )
  let diagnostics = lines

  if (isPytestTranscript(normalizedLines)) {
    const withoutSessionNoise = lines.filter(
      (line) => isPytestFailureLine(line) || !isPytestSessionNoiseLine(line),
    )
    const failures = withoutSessionNoise.filter((line) =>
      isPytestFailureLine(line),
    )

    // Keeping only recognized failure shapes prevents traceback churn, but a
    // failing transcript whose failure text matches no known pytest shape must
    // not be discarded whole: a command that runs pytest plus another tool
    // (pytest passing, the other tool regressing) would then lose the genuine
    // failure and the gate would pass. The fallback keeps only error-looking
    // lines, so a passing suite's warnings and code context still form no
    // identities and the status identity alone carries the command failure.
    diagnostics =
      failures.length > 0
        ? failures
        : withoutSessionNoise.filter(
            (line) =>
              /\b(?:error|errors|failed|failure|failures|exception|traceback|fatal|internalerror)\b/iu.test(
                line,
              ) &&
              // Source context quoted under a warning or traceback is not an
              // error record even when it names an exception type.
              !/^(?:class|def|@|import |from )\s*\w/u.test(line),
          )
  }

  const counts = new Map<string, number>()

  for (const line of diagnostics) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }

  return counts
}

/**
 * Normalized failure diagnostics one command result contributes. Exported so
 * the environment-blocked classification can judge a baseline command by its
 * extracted failure evidence rather than by raw transcript substrings.
 */
export function commandFailureDiagnostics(
  result: RepositoryCheckCommandResult,
  workspaceRoot: string,
): string[] {
  return [...diagnosticCounts(result, workspaceRoot).keys()]
}

function normalizedCommand(command: string): string {
  return command.trim().replaceAll(/\s+/gu, ' ')
}

function failedCommandKey(result: RepositoryCheckCommandResult): string {
  return `${result.kind}:${normalizedCommand(result.command)}`
}

interface DiagnosticIdentity {
  kind: 'probe' | 'command'
  command: string
  diagnostic: string
}

/**
 * Count every diagnostic identity a result set contributes, keyed by the command
 * that produced it. Only failing commands contribute: a passing suite prints
 * ordinary progress output that would otherwise register as a regression the
 * moment a test is added.
 */
export function failureDiagnostics(
  result: RepositoryCheckResult,
): Map<string, { identity: DiagnosticIdentity; count: number }> {
  const counts = new Map<
    string,
    { identity: DiagnosticIdentity; count: number }
  >()

  for (const entry of result.results) {
    if (entry.passed) {
      continue
    }

    const commandKey = failedCommandKey(entry)

    for (const [diagnostic, count] of diagnosticCounts(
      entry,
      result.workspace_root,
    )) {
      const key = `${commandKey}\u0000${diagnostic}`
      const existing = counts.get(key)

      if (existing) {
        existing.count += count
        continue
      }

      counts.set(key, {
        identity: {
          kind: entry.kind,
          command: normalizedCommand(entry.command),
          diagnostic,
        },
        count,
      })
    }
  }

  return counts
}

/** How each failing command failed, keyed by command identity. */
export function failureStatuses(
  result: RepositoryCheckResult,
): Map<string, DiagnosticIdentity> {
  const statuses = new Map<string, DiagnosticIdentity>()

  for (const entry of result.results) {
    if (entry.passed) {
      continue
    }

    statuses.set(failedCommandKey(entry), {
      kind: entry.kind,
      command: normalizedCommand(entry.command),
      diagnostic: statusIdentityDiagnostic(entry),
    })
  }

  return statuses
}

export function sortDiagnostics(
  entries: RepositoryCheckDiagnostic[],
): RepositoryCheckDiagnostic[] {
  return [...entries].sort(
    (left, right) =>
      left.command.localeCompare(right.command) ||
      left.diagnostic.localeCompare(right.diagnostic),
  )
}
