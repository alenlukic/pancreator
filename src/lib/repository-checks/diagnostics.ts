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

/** Profile name a `pan repository-check <profile>` command runs, or null for any other command. */
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
  assertion = false,
  literal = false,
): string {
  if (literal) {
    return stripAnsi(line)
  }
  const clean = stripAnsi(line).trim()
  const identities = assertion
    ? clean
    : clean.replaceAll(
        /^(\s*["'](?:current_head|candidate_head|tip_before|tip_after|workspace_fingerprint)["']\s*:\s*["'])(?:[a-f0-9]{64}|[a-f0-9]{40})(["'],?\s*)$/giu,
        '$1<execution-identity>$2',
      )
  const slashed = identities.replaceAll('\\', '/')
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
      // A TAP index shifts whenever a suite gains or loses a case, so keeping it
      // would report every surviving failure as both fixed and new.
      .replaceAll(/^((?:not )?ok)\s+\d+\b/giu, '$1 <index>')
      .replaceAll(/([/\w.-]+\.[a-z][\w-]*):\d+:\d+/giu, '$1:<line>:<column>')
      .replaceAll(/([/\w.-]+\.[a-z][\w-]*):\d+/giu, '$1:<line>')
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
    /^ok - /u.test(line) ||
    /^ok <index>(?:\s|$)/u.test(line) ||
    /^\d+\.\.\d+(?:\s+#.*)?$/u.test(line) ||
    /^(?:\[tests impacted\] )?# heartbeat \d+(?:\.\d+)?s: \d+ passed, \d+ failed, \d+ files done$/u.test(
      line,
    ) ||
    /^\[tests impacted\] (?:FAILED: \d+ of \d+ lane test file\(s\) \(exit -?\d+\)|passed: \d+ of \d+ lane test file\(s\)(?:, \d+ tests)?) in \d+(?:\.\d+)?s(?: \(log: [^)]+\))?$/u.test(
      line,
    ) ||
    /^log: runtime\/logs\/checks\/\S+$/u.test(line) ||
    /^\[tests impacted\] running \d+ of \d+ lane test(?:s\b| file\(s\)(?:\s|$))/u.test(
      line,
    ) ||
    /^Selected \d+ of \d+ lane tests for \d+ changed file\(s\)\.$/u.test(
      line,
    ) ||
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
    /^(?:platform \S+ -- Python |plugins:|rootdir:|configfile:|collecting\b|collected \d+)/iu.test(
      line,
    ) ||
    /^(?:cachedir:|timeout: \d+(?:\.\d+)?s$|timeout method: (?:signal|thread)$|timeout func_only: (?:True|False)$|asyncio:|hypothesis profile\b)/iu.test(
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

function isPytestWarningLine(line: string): boolean {
  return /^[\w./<>-]+:(?:\d+|<line>): \w+Warning:/u.test(line)
}

/**
 * Keep an assertion attached to its case. Numbered TAP records identify an
 * occurrence; a repeated rendering of that same occurrence is not another test.
 * Unnumbered failures remain a multiset unless a runner summary repeats them.
 */
function runnerDiagnostics(
  rawLines: string[],
  normalize: (line: string, assertion?: boolean, literal?: boolean) => string,
): string[] {
  const documents: string[][] = []
  let document: string[] = []
  for (const line of rawLines) {
    if (/^TAP version \d+\s*$/u.test(stripAnsi(line)) && document.length > 0) {
      documents.push(document)
      document = []
    }
    document.push(line)
  }
  documents.push(document)
  return documents.flatMap((lines) =>
    runnerDocumentDiagnostics(lines, normalize),
  )
}

function runnerDocumentDiagnostics(
  rawLines: string[],
  normalize: (line: string, assertion?: boolean, literal?: boolean) => string,
): string[] {
  const diagnostics: string[] = []
  const summary: string[] = []
  const numbered = new Set<string>()
  const suites: Array<{ depth: number; name: string; instance: number }> = []
  let suiteInstance = 0
  let inSummary = false

  for (let index = 0; index < rawLines.length; index += 1) {
    const raw = stripAnsi(rawLines[index])
    if (raw === '# failing tests:') {
      inSummary = true
      continue
    }
    if (inSummary && /^# test at /u.test(raw)) {
      continue
    }
    const subtest = /^(\s*)# Subtest: (.+)$/u.exec(raw)
    if (subtest) {
      while (
        suites.length > 0 &&
        suites[suites.length - 1].depth >= subtest[1].length
      ) {
        suites.pop()
      }
      suiteInstance += 1
      suites.push({
        depth: subtest[1].length,
        name: subtest[2],
        instance: suiteInstance,
      })
      continue
    }
    const match = /^(\s*)not ok(?: (\d+))? - (.+)$/u.exec(raw)
    if (!match) {
      const line = normalize(raw)
      if (line) {
        const target = inSummary ? summary : diagnostics
        target.push(line)
      }
      continue
    }

    const body: string[] = []
    const indent = match[1].length
    let yaml = false
    let complete = false
    let literalDepth: number | null = null
    for (; index + 1 < rawLines.length; index += 1) {
      const next = stripAnsi(rawLines[index + 1])
      if (next.trim().length === 0) {
        if (literalDepth !== null) {
          body.push(normalize(next.slice(indent + 2), true, true))
        }
        continue
      }
      const depth = /^\s*/u.exec(next)![0].length
      if (depth <= indent) {
        break
      }
      if (!yaml && next.trim() === '---') {
        yaml = true
        continue
      }
      if (yaml && depth === indent + 2 && next.trim() === '...') {
        complete = true
        index += 1
        break
      }
      if (literalDepth !== null && depth <= literalDepth) {
        literalDepth = null
      }
      if (
        yaml &&
        depth === indent + 2 &&
        (/^(?:expected|actual):/u.test(next.trim()) ||
          /^error:\s*[|>]/u.test(next.trim()))
      ) {
        literalDepth = depth
      }
      // Only the immediate YAML fields are runner metadata. Nested values of
      // expected/actual (even fields named duration_ms) remain assertion data.
      if (
        yaml &&
        depth === indent + 2 &&
        /^(?:duration_ms|type):/u.test(next.trim())
      ) {
        continue
      }
      body.push(
        normalize(
          literalDepth === null ? next : next.slice(indent + 2),
          true,
          literalDepth !== null,
        ),
      )
    }
    const parents = suites
      .filter((suite) => suite.depth < indent)
      .map((suite) => normalize(suite.name))
    const header =
      normalize(raw) +
      (parents.length > 0 ? ` (suite: ${parents.join(' > ')})` : '')
    const record = [
      header,
      ...body,
      ...(yaml && !complete ? ['<incomplete TAP assertion>'] : []),
    ].join('\n')
    const occurrence =
      match[2] === undefined
        ? null
        : `${suites.map((suite) => suite.instance).join('/')}:${indent}:${match[2]}:${record}`
    if (occurrence !== null && numbered.has(occurrence)) {
      continue
    }
    if (occurrence !== null) {
      numbered.add(occurrence)
    }
    const target = inSummary ? summary : diagnostics
    target.push(record)
  }

  // A closing failure list repeats the main records, but can also be the only
  // retained evidence in a truncated transcript. Keep the greater multiplicity.
  const remaining = new Map<string, number>()
  for (const diagnostic of diagnostics) {
    remaining.set(diagnostic, (remaining.get(diagnostic) ?? 0) + 1)
  }
  for (const diagnostic of summary) {
    const count = remaining.get(diagnostic) ?? 0
    if (count > 0) {
      remaining.set(diagnostic, count - 1)
    } else {
      diagnostics.push(diagnostic)
    }
  }
  return diagnostics
}

function diagnosticCounts(
  result: RepositoryCheckCommandResult,
  workspaceRoot: string,
): Map<string, number> {
  const externalScratch = externalTestScratchRoot(workspaceRoot)
  const normalizedLines = [
    result.stdout,
    result.stderr,
    result.error ?? '',
  ].flatMap((output) =>
    runnerDiagnostics(output.split(/\r?\n/u), (line, assertion, literal) =>
      normalizeDiagnosticLine(
        line,
        workspaceRoot,
        externalScratch,
        assertion,
        literal,
      ),
    ),
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

    // Exclude recognized warning reports and their source context; unknown
    // output remains evidence even when pytest has already named a failure.
    diagnostics = withoutSessionNoise.filter(
      (line, index) =>
        isPytestFailureLine(line) ||
        !(
          /^[\w./<>-]+:(?:\d+|<line>): \d+ warnings?$/u.test(line) ||
          isPytestWarningLine(line) ||
          (/^(?:class \w+.*:|@\w+(?:\.\w+)*|self\.loader\.exec_module\(module\))$/u.test(
            line,
          ) &&
            (isPytestWarningLine(withoutSessionNoise[index - 1] ?? '') ||
              isPytestWarningLine(withoutSessionNoise[index + 1] ?? ''))) ||
          /^\[Statsig::DynamicConfig\]: Type mismatch - /u.test(line)
        ),
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

/** Copy of the diagnostics sorted by command, then diagnostic text. */
export function sortDiagnostics(
  entries: RepositoryCheckDiagnostic[],
): RepositoryCheckDiagnostic[] {
  return [...entries].sort(
    (left, right) =>
      left.command.localeCompare(right.command) ||
      left.diagnostic.localeCompare(right.diagnostic),
  )
}
