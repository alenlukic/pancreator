import { spawn, spawnSync } from 'node:child_process'
import path from 'node:path'

import { PanError, invariant } from './errors.js'
import { fileExists, isRecord, readJson } from './io.js'
import {
  configuredWorkspaceRoot,
  isSelfDevelopmentInstallation,
} from './project-config.js'
import type {
  RepositoryCheckDelta,
  RepositoryCheckDiagnostic,
} from './types.js'

const DEFAULT_TIMEOUT_MS = 600_000
const MAX_CAPTURE_BYTES = 10 * 1024 * 1024
const SLOW_PASS_ADVISORY_MS = 60_000
const EMBEDDED_DELTA_LIMIT = 100

export interface RepositoryCheckProfile {
  description?: string
  timeout_ms?: number
  environment_probes?: string[]
  probes: string[]
  commands: string[]
}

export interface RepositoryChecksConfig {
  schema_version: 1
  source_head?: string
  /**
   * Commands that bootstrap a fresh workspace before profile commands can run.
   * A new worktree carries no ignored build state (dependencies, compiled
   * output), so checks there are doomed until setup has run.
   */
  setup?: string[]
  profiles: Record<string, RepositoryCheckProfile>
}

export interface RepositoryCheckCommandResult {
  kind: 'probe' | 'command'
  command: string
  exit_code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  passed: boolean
  timed_out: boolean
  duration_ms: number
  error?: string
}

export interface RepositoryCheckResult {
  profile: string
  status: 'passed' | 'failed' | 'not_configured'
  config_path: string
  workspace_root: string
  timeout_ms: number
  description?: string
  results: RepositoryCheckCommandResult[]
  total_duration_ms: number
  advisories: string[]
}

export interface RepositoryCheckRunOptions {
  timeout_ms?: number
  /**
   * Directory the profile commands run in, absolute or installation-relative.
   * Absent means the configured workspace root. A run that targets a worktree
   * passes its own workspace so checks observe the worktree, not the main
   * checkout.
   */
  workspace?: string
}

export interface RepositoryCheckStreamingOptions extends RepositoryCheckRunOptions {
  on_start?: (
    kind: RepositoryCheckCommandResult['kind'],
    command: string,
  ) => void
  on_stdout?: (chunk: string) => void
  on_stderr?: (chunk: string) => void
}

export interface RepositoryCheckBaselineArtifact {
  schema_version: 1
  run_id: string
  stage: string
  profile: string
  workspace_fingerprint: string
  recorded_at: string
  /**
   * Uncommitted workspace paths at capture time, so an inherited failure is
   * attributable instead of reading as pre-existing repository state. Capped;
   * `workspace_dirty_path_count` carries the full count. Absent on records
   * written before provenance capture existed.
   */
  workspace_dirty_paths?: string[]
  workspace_dirty_path_count?: number
  /** Run whose final workspace fingerprint matches this dirty starting state. */
  predecessor_run_id?: string
  result: RepositoryCheckResult
  /** Set when `result` holds elided output and the untruncated run lives elsewhere. */
  full_result_path?: string
}

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

export interface RepositoryCheckBaselineComparison {
  passed: boolean
  explanation: string
  delta: RepositoryCheckDelta
}

function emptyDelta(): RepositoryCheckDelta {
  return { new: [], fixed: [], carried: [] }
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

function normalizeDiagnosticLine(line: string, workspaceRoot: string): string {
  return (
    stripAnsi(line)
      .replaceAll('\\', '/')
      .replaceAll(workspaceRoot.replaceAll('\\', '/'), '<workspace>')
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
  const normalizedLines =
    `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`
      .split(/\r?\n/u)
      .map((line) => normalizeDiagnosticLine(line, workspaceRoot))
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
function failureDiagnostics(
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
function failureStatuses(
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

function sortDiagnostics(
  entries: RepositoryCheckDiagnostic[],
): RepositoryCheckDiagnostic[] {
  return [...entries].sort(
    (left, right) =>
      left.command.localeCompare(right.command) ||
      left.diagnostic.localeCompare(right.diagnostic),
  )
}

/**
 * Compare a repository-check result with its pre-implementation baseline as a
 * multiset of diagnostic identities.
 *
 * The carried count for an identity is the smaller of the two counts. A positive
 * surplus in the current run is a regression, and a positive surplus in the
 * baseline is a repair. Duplicate identical diagnostics therefore stay
 * distinguishable from one duplicated diagnostic that is genuinely new.
 */
export function compareRepositoryCheckToBaseline(
  baseline: RepositoryCheckResult,
  current: RepositoryCheckResult,
): RepositoryCheckBaselineComparison {
  if (current.status === 'not_configured') {
    return {
      passed: false,
      explanation: `Repository check '${current.profile}' is not configured.`,
      delta: emptyDelta(),
    }
  }

  const baselineDiagnostics = failureDiagnostics(baseline)
  const currentDiagnostics = failureDiagnostics(current)
  const added: RepositoryCheckDiagnostic[] = []
  const fixed: RepositoryCheckDiagnostic[] = []
  const carried: RepositoryCheckDiagnostic[] = []

  for (const [key, entry] of currentDiagnostics) {
    const before = baselineDiagnostics.get(key)?.count ?? 0
    const shared = Math.min(before, entry.count)

    if (shared > 0) {
      carried.push({ ...entry.identity, count: shared })
    }

    if (entry.count > before) {
      added.push({ ...entry.identity, count: entry.count - before })
    }
  }

  for (const [key, entry] of baselineDiagnostics) {
    const after = currentDiagnostics.get(key)?.count ?? 0

    if (entry.count > after) {
      fixed.push({ ...entry.identity, count: entry.count - after })
    }
  }

  // A status identity participates only when the two sides disagree about it, so
  // an unchanged exit code adds no noise while a command that starts failing,
  // stops failing, times out, or dies on a signal is always visible.
  const baselineStatuses = failureStatuses(baseline)
  const currentStatuses = failureStatuses(current)

  for (const [key, identity] of currentStatuses) {
    if (baselineStatuses.get(key)?.diagnostic !== identity.diagnostic) {
      added.push({ ...identity, count: 1 })
    }
  }

  for (const [key, identity] of baselineStatuses) {
    if (currentStatuses.get(key)?.diagnostic !== identity.diagnostic) {
      fixed.push({ ...identity, count: 1 })
    }
  }

  const sorted = {
    new: sortDiagnostics(added),
    fixed: sortDiagnostics(fixed),
    carried: sortDiagnostics(carried),
  }
  const delta: RepositoryCheckDelta = {
    new: sorted.new.slice(0, EMBEDDED_DELTA_LIMIT),
    fixed: sorted.fixed.slice(0, EMBEDDED_DELTA_LIMIT),
    carried: sorted.carried.slice(0, EMBEDDED_DELTA_LIMIT),
    counts: {
      new: sorted.new.length,
      fixed: sorted.fixed.length,
      carried: sorted.carried.length,
    },
    ...(sorted.new.length > EMBEDDED_DELTA_LIMIT ||
    sorted.fixed.length > EMBEDDED_DELTA_LIMIT ||
    sorted.carried.length > EMBEDDED_DELTA_LIMIT
      ? { full: sorted }
      : {}),
  }
  const passed = current.status === 'passed' || sorted.new.length === 0
  const counts =
    `${sorted.new.length} new, ${sorted.fixed.length} fixed, ` +
    `${sorted.carried.length} carried`

  if (!passed) {
    const first = delta.new.find(
      (diagnostic) => !diagnostic.diagnostic.startsWith('<status>'),
    )

    return {
      passed: false,
      explanation:
        first === undefined
          ? `Repository check '${current.profile}' introduced a new failure state, ` +
            `but its output exposed no genuine failure identity (${counts}).`
          : `Repository check '${current.profile}' introduced a new failure in ` +
            `'${first.command}': ${first.diagnostic} (${counts}).`,
      delta,
    }
  }

  if (current.status === 'passed') {
    return {
      passed: true,
      explanation:
        delta.fixed.length > 0
          ? `Repository check '${current.profile}' passes and repaired ` +
            `${delta.fixed.length} inherited failure identities.`
          : `Repository check '${current.profile}' passes.`,
      delta,
    }
  }

  return {
    passed: true,
    explanation:
      `Repository check '${current.profile}' still reports only failures ` +
      `captured before implementation (${counts}).`,
    delta,
  }
}

export function repositoryChecksPath(root: string): string {
  return path.join(root, 'runtime', 'repository-checks.json')
}

/** `<installation>/runtime/worktrees/...` resolves to the installation root. */
function owningInstallationRoot(root: string): string | null {
  const segments = path.resolve(root).split(path.sep)
  const index = segments.lastIndexOf('worktrees')

  return index > 0 && segments[index - 1] === 'runtime'
    ? segments.slice(0, index - 1).join(path.sep) || path.sep
    : null
}

export function repositoryChecksSourcePath(root: string): string {
  const runtimePath = repositoryChecksPath(root)

  if (fileExists(runtimePath)) {
    return runtimePath
  }

  // The runtime configuration is untracked per-installation state, so a git
  // worktree never carries it. A harness-managed worktree resolves the owning
  // installation's file instead of silently weakening the suite through the
  // template fallback.
  const installationRoot = owningInstallationRoot(root)

  if (installationRoot) {
    const installationPath = repositoryChecksPath(installationRoot)

    if (fileExists(installationPath)) {
      return installationPath
    }
  }

  if (!isSelfDevelopmentInstallation(root)) {
    return runtimePath
  }

  return path.join(
    root,
    'library',
    'templates',
    'repository-checks.self-development.json',
  )
}

function stringArray(value: unknown, source: string): string[] {
  invariant(Array.isArray(value), `${source} MUST be an array.`, {
    code: 'INVALID_REPOSITORY_CHECKS',
  })

  for (const [index, item] of value.entries()) {
    invariant(
      typeof item === 'string' && item.trim().length > 0,
      `${source}[${index}] MUST be a non-empty command string.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )
  }

  return value as string[]
}

function optionalTimeout(value: unknown, source: string): number | undefined {
  if (value === undefined) {
    return undefined
  }

  invariant(
    typeof value === 'number' &&
      Number.isInteger(value) &&
      value >= 1_000 &&
      value <= 86_400_000,
    `${source} MUST be an integer between 1000 and 86400000 milliseconds.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  return value
}

function normalizedCommands(commands: string[]): string[] {
  return commands.map((command) => command.trim().replaceAll(/\s+/gu, ' '))
}

function commandSetIsSubset(left: string[], right: string[]): boolean {
  if (left.length === 0) {
    return false
  }

  const rightCommands = new Set(normalizedCommands(right))

  return normalizedCommands(left).every((command) => rightCommands.has(command))
}

function sameCommands(left: string[], right: string[]): boolean {
  if (left.length === 0 || left.length !== right.length) {
    return false
  }

  const normalizedLeft = normalizedCommands(left)
  const normalizedRight = normalizedCommands(right)

  return normalizedLeft.every(
    (command, index) => command === normalizedRight[index],
  )
}

function validateProfileSemantics(
  filePath: string,
  profiles: Record<string, RepositoryCheckProfile>,
): void {
  const fast = profiles.fast
  const full = profiles.full

  invariant(
    !fast || !full || !sameCommands(fast.commands, full.commands),
    `${filePath}.profiles.fast MUST NOT duplicate profiles.full. Use the repository's documented fast/default command, or leave fast unconfigured when no distinct iterative suite exists.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  for (const [name, profile] of Object.entries(profiles)) {
    if (profile.timeout_ms === undefined) {
      continue
    }

    for (const [subsetName, subset] of Object.entries(profiles)) {
      if (
        subsetName === name ||
        subset.timeout_ms === undefined ||
        !commandSetIsSubset(subset.commands, profile.commands)
      ) {
        continue
      }

      invariant(
        profile.timeout_ms >= subset.timeout_ms,
        `${filePath}.profiles.${name}.timeout_ms MUST be at least ` +
          `${filePath}.profiles.${subsetName}.timeout_ms because '${name}' ` +
          `runs a superset of '${subsetName}'.`,
        { code: 'INVALID_REPOSITORY_CHECKS' },
      )
    }
  }
}

export function loadRepositoryChecks(root: string): RepositoryChecksConfig {
  const filePath = repositoryChecksSourcePath(root)

  if (!fileExists(filePath)) {
    return { schema_version: 1, profiles: {} }
  }

  const value = readJson(filePath)

  invariant(
    isRecord(value) && value.schema_version === 1 && isRecord(value.profiles),
    `${filePath} MUST contain a schema_version 1 repository-check profile map.`,
    { code: 'INVALID_REPOSITORY_CHECKS' },
  )

  const profiles: Record<string, RepositoryCheckProfile> = {}

  for (const [name, rawProfile] of Object.entries(value.profiles)) {
    invariant(
      isRecord(rawProfile),
      `${filePath}.profiles.${name} MUST be an object.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )
    invariant(
      rawProfile.description === undefined ||
        typeof rawProfile.description === 'string',
      `${filePath}.profiles.${name}.description MUST be a string when present.`,
      { code: 'INVALID_REPOSITORY_CHECKS' },
    )

    const timeoutMs = optionalTimeout(
      rawProfile.timeout_ms,
      `${filePath}.profiles.${name}.timeout_ms`,
    )

    profiles[name] = {
      ...(typeof rawProfile.description === 'string'
        ? { description: rawProfile.description }
        : {}),
      ...(timeoutMs !== undefined ? { timeout_ms: timeoutMs } : {}),
      environment_probes: stringArray(
        rawProfile.environment_probes ?? [],
        `${filePath}.profiles.${name}.environment_probes`,
      ),
      probes: stringArray(
        rawProfile.probes ?? [],
        `${filePath}.profiles.${name}.probes`,
      ),
      commands: stringArray(
        rawProfile.commands ?? [],
        `${filePath}.profiles.${name}.commands`,
      ),
    }
  }

  validateProfileSemantics(filePath, profiles)

  const setup =
    value.setup === undefined
      ? undefined
      : stringArray(value.setup, `${filePath}.setup`)

  return {
    schema_version: 1,
    ...(typeof value.source_head === 'string'
      ? { source_head: value.source_head }
      : {}),
    ...(setup !== undefined ? { setup } : {}),
    profiles,
  }
}

export interface RepositorySetupResult {
  status: 'passed' | 'failed' | 'not_configured'
  workspace_root: string
  results: RepositoryCheckCommandResult[]
  total_duration_ms: number
}

/**
 * Run the target-declared workspace setup commands (dependency install,
 * build) in the given workspace, stopping at the first failure.
 */
export function runRepositorySetup(
  root: string,
  options: RepositoryCheckRunOptions = {},
): RepositorySetupResult {
  const config = loadRepositoryChecks(root)
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const commands = config.setup ?? []
  const timeoutMs = options.timeout_ms ?? DEFAULT_TIMEOUT_MS
  const results: RepositoryCheckCommandResult[] = []
  let status: RepositorySetupResult['status'] =
    commands.length > 0 ? 'passed' : 'not_configured'

  for (const command of commands) {
    const result = execute('command', command, workspaceRoot, timeoutMs)

    results.push(result)

    if (!result.passed) {
      status = 'failed'
      break
    }
  }

  return {
    status,
    workspace_root: workspaceRoot,
    results,
    total_duration_ms: results.reduce(
      (total, result) => total + result.duration_ms,
      0,
    ),
  }
}

function effectiveTimeout(
  config: RepositoryChecksConfig,
  profileName: string,
  profile: RepositoryCheckProfile | undefined,
  requested: number | undefined,
): number {
  // The profile's own bound participates as its explicit timeout or the
  // default, so a shorter subset timeout can only raise the result, never
  // lower it below what the profile would get on its own.
  const candidates = [
    requested,
    profile === undefined
      ? undefined
      : (profile.timeout_ms ?? DEFAULT_TIMEOUT_MS),
    ...Object.entries(config.profiles)
      .filter(
        ([name, candidate]) =>
          name !== profileName &&
          candidate.timeout_ms !== undefined &&
          profile !== undefined &&
          commandSetIsSubset(candidate.commands, profile.commands),
      )
      .map(([, candidate]) => candidate.timeout_ms),
  ].filter((value): value is number => value !== undefined)

  return candidates.length > 0 ? Math.max(...candidates) : DEFAULT_TIMEOUT_MS
}

function appendCaptured(current: string, chunk: string): string {
  if (Buffer.byteLength(current) >= MAX_CAPTURE_BYTES) {
    return current
  }

  const combined = current + chunk

  if (Buffer.byteLength(combined) <= MAX_CAPTURE_BYTES) {
    return combined
  }

  const available = Math.max(0, MAX_CAPTURE_BYTES - Buffer.byteLength(current))
  const truncated = Buffer.from(chunk).subarray(0, available).toString('utf8')

  return `${current}${truncated}\n[output truncated by Pancreator]\n`
}

function execute(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  timeoutMs: number,
): RepositoryCheckCommandResult {
  const startedAt = Date.now()
  const result = spawnSync(command, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    shell: true,
    maxBuffer: MAX_CAPTURE_BYTES,
    timeout: timeoutMs,
    env: { ...process.env },
  })

  return {
    kind,
    command,
    exit_code: result.status,
    signal: result.signal,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    passed: result.status === 0 && !result.error,
    timed_out:
      result.error instanceof Error &&
      'code' in result.error &&
      result.error.code === 'ETIMEDOUT',
    duration_ms: Date.now() - startedAt,
    ...(result.error ? { error: result.error.message } : {}),
  }
}

function executeStreaming(
  kind: RepositoryCheckCommandResult['kind'],
  command: string,
  workspaceRoot: string,
  timeoutMs: number,
  options: RepositoryCheckStreamingOptions,
): Promise<RepositoryCheckCommandResult> {
  options.on_start?.(kind, command)
  const startedAt = Date.now()

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: workspaceRoot,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    let timeoutHandle: NodeJS.Timeout | undefined
    let killHandle: NodeJS.Timeout | undefined

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error?: Error,
    ): void => {
      if (settled) {
        return
      }

      settled = true

      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }

      if (killHandle) {
        clearTimeout(killHandle)
      }

      const timeoutError = timedOut
        ? `Command timed out after ${timeoutMs}ms.`
        : undefined
      const errorText = error?.message ?? timeoutError

      resolve({
        kind,
        command,
        exit_code: exitCode,
        signal,
        stdout,
        stderr,
        passed: exitCode === 0 && !errorText,
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
        ...(errorText ? { error: errorText } : {}),
      })
    }

    child.stdout?.on('data', (value: Buffer | string) => {
      const chunk = value.toString()
      stdout = appendCaptured(stdout, chunk)
      options.on_stdout?.(chunk)
    })
    child.stderr?.on('data', (value: Buffer | string) => {
      const chunk = value.toString()
      stderr = appendCaptured(stderr, chunk)
      options.on_stderr?.(chunk)
    })
    child.on('error', (error) => finish(null, null, error))
    child.on('close', (exitCode, signal) => finish(exitCode, signal))

    timeoutHandle = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      killHandle = setTimeout(() => child.kill('SIGKILL'), 2_000)
      killHandle.unref()
    }, timeoutMs)
    timeoutHandle.unref()
  })
}

function baseResult(
  root: string,
  profileName: string,
  configPath: string,
  workspaceRoot: string,
  timeoutMs: number,
  profile: RepositoryCheckProfile | undefined,
  status: RepositoryCheckResult['status'],
  results: RepositoryCheckCommandResult[],
): RepositoryCheckResult {
  const totalDurationMs = results.reduce(
    (total, result) => total + result.duration_ms,
    0,
  )
  const advisories =
    status === 'passed' && totalDurationMs >= SLOW_PASS_ADVISORY_MS
      ? [
          `FYI: repository check '${profileName}' passed but took ${totalDurationMs}ms. Clock time alone does not block the pipeline.`,
        ]
      : []

  return {
    profile: profileName,
    status,
    config_path: path.relative(root, configPath).split(path.sep).join('/'),
    workspace_root: workspaceRoot,
    timeout_ms: timeoutMs,
    ...(profile?.description ? { description: profile.description } : {}),
    results,
    total_duration_ms: totalDurationMs,
    advisories,
  }
}

export function runRepositoryCheck(
  root: string,
  profileName: string,
  options: RepositoryCheckRunOptions = {},
): RepositoryCheckResult {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const timeoutMs = effectiveTimeout(
    config,
    profileName,
    profile,
    options.timeout_ms,
  )

  if (!profile || profile.commands.length === 0) {
    return baseResult(
      root,
      profileName,
      configPath,
      workspaceRoot,
      timeoutMs,
      profile,
      'not_configured',
      [],
    )
  }

  const results: RepositoryCheckCommandResult[] = []

  for (const command of [
    ...(profile.environment_probes ?? []),
    ...profile.probes,
  ]) {
    const result = execute('probe', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  // Probes are preconditions and stop the profile, but the commands are
  // independently meaningful partitions: an early backend failure MUST NOT
  // leave the frontend partition uncaptured, or the baseline would represent
  // surfaces it never observed.
  let commandsPassed = true

  for (const command of profile.commands) {
    const result = execute('command', command, workspaceRoot, timeoutMs)
    results.push(result)

    if (!result.passed) {
      commandsPassed = false
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    commandsPassed ? 'passed' : 'failed',
    results,
  )
}

export async function runRepositoryCheckStreaming(
  root: string,
  profileName: string,
  options: RepositoryCheckStreamingOptions = {},
): Promise<RepositoryCheckResult> {
  const config = loadRepositoryChecks(root)
  const configPath = repositoryChecksSourcePath(root)
  const profile = config.profiles[profileName]
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const timeoutMs = effectiveTimeout(
    config,
    profileName,
    profile,
    options.timeout_ms,
  )

  if (!profile || profile.commands.length === 0) {
    return baseResult(
      root,
      profileName,
      configPath,
      workspaceRoot,
      timeoutMs,
      profile,
      'not_configured',
      [],
    )
  }

  const results: RepositoryCheckCommandResult[] = []

  for (const command of [
    ...(profile.environment_probes ?? []),
    ...profile.probes,
  ]) {
    const result = await executeStreaming(
      'probe',
      command,
      workspaceRoot,
      timeoutMs,
      options,
    )
    results.push(result)

    if (!result.passed) {
      return baseResult(
        root,
        profileName,
        configPath,
        workspaceRoot,
        timeoutMs,
        profile,
        'failed',
        results,
      )
    }
  }

  // Same partition contract as the synchronous runner: every configured
  // command records its result even after an earlier command fails.
  let commandsPassed = true

  for (const command of profile.commands) {
    const result = await executeStreaming(
      'command',
      command,
      workspaceRoot,
      timeoutMs,
      options,
    )
    results.push(result)

    if (!result.passed) {
      commandsPassed = false
    }
  }

  return baseResult(
    root,
    profileName,
    configPath,
    workspaceRoot,
    timeoutMs,
    profile,
    commandsPassed ? 'passed' : 'failed',
    results,
  )
}

export function assertRepositoryChecksValid(
  root: string,
): RepositoryChecksConfig {
  try {
    return loadRepositoryChecks(root)
  } catch (error) {
    if (error instanceof PanError) {
      throw error
    }

    throw new PanError('Repository check configuration is invalid.', {
      code: 'INVALID_REPOSITORY_CHECKS',
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    })
  }
}
