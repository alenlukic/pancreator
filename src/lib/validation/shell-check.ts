/** Gate test-failure classification and shell-criterion execution. */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { loadavg, availableParallelism } from 'node:os'
import path from 'node:path'

import { isNodeError } from '../errors.js'
import { writeTextAtomic, fileExists, toRepoRelative } from '../io.js'
import {
  repositoryCheckTestFailures,
  isolationExecutedTest,
  parseTestFailureIdentity,
  creditKnownFailures,
  failedRepositoryCheckLanes,
} from '../known-failing.js'
import {
  compareRepositoryCheckToBaseline,
  loadRepositoryChecks,
  commandFailureDiagnostics,
  runRepositoryCheck,
} from '../repository-checks.js'
import type { RepositoryCheckResult } from '../repository-checks.js'
import {
  SUITE_PROFILE_GATE_PROFILE,
  suiteProfileEvidencePath,
  TEST_PROFILE_ENV,
} from '../suite-profile.js'
import {
  FAST_WALL_SERIES_ROOT_ENV,
  FAST_WALL_RUN_ID_ENV,
  FAST_WALL_PHASE_ENV,
  FAST_WALL_CALLER_CLASS_ENV,
  appendTargetFastWallRun,
  FAST_WALL_CRITERION_ID,
} from '../fast-wall-series.js'
import { buildModuleGraphByRegex } from '../test-impact/graph.js'
import { selectImpactedTests } from '../test-impact/select.js'
import {
  repositoryCheckGateCommand,
  gateCacheableSnapshot,
  gateCacheKey,
  gateCacheLookupForGate,
  gateCacheStore,
  buildGateCacheEntry,
} from '../gate-cache.js'
import {
  snapshotEntryPath,
  workspaceAbsorbedPathsFromSnapshots,
} from '../git.js'
import type {
  WorkspaceSnapshot,
  Criterion,
  GateFailureClassification,
  RunState,
  StageDefinition,
  DeterministicResult,
} from '../types.js'
import { boundEvidenceStream } from './artifacts.js'
import {
  absoluteJudgingDisclosure,
  isEnvironmentBlockedDelta,
  loadRepositoryCheckBaseline,
  resolveShellCheck,
} from './baselines.js'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

/**
 * A literal test name as an anchored regular expression.
 *
 * Every single-test selector this repository configures takes a pattern, not
 * a literal. A name carrying `(`, `.`, or `|` therefore selects the wrong
 * tests or, far worse, no test at all — and a filter that selects nothing
 * exits cleanly.
 */
function testNamePattern(value: string): string {
  return `^${value.replaceAll(/[\\^$.*+?()[\]{}|/]/gu, '\\$&')}$`
}

/**
 * Environment for an isolated rerun.
 *
 * A rerun must be a standalone runner invocation. `node --test` marks its
 * children with `NODE_TEST_CONTEXT`, and a runner that finds that marker
 * declines to run any file and still exits zero — a clean exit that executed
 * nothing, which is the one signal this classifier must never read as a pass.
 */
function isolationEnvironment(): NodeJS.ProcessEnv {
  const { NODE_TEST_CONTEXT: _testContext, ...environment } = process.env

  return environment
}

/**
 * Substitute one isolation-command placeholder with a shell-quoted value.
 *
 * The replacement is supplied as a function because a replacement *string*
 * reads `$&` and `$'` as patterns, and an anchored test pattern ends in
 * exactly `$'`.
 */
function substituteIsolationToken(
  template: string,
  token: string,
  value: string,
): string {
  return template.replaceAll(token, () => shellQuote(value))
}

function relativeFailureFile(file: string, workspaceDir: string): string {
  const normalized = file.replaceAll('\\', '/')
  const workspace = workspaceDir.replaceAll('\\', '/').replace(/\/$/u, '')

  if (normalized.startsWith('<workspace>/')) {
    return normalized.slice('<workspace>/'.length)
  }

  if (normalized.startsWith(`${workspace}/`)) {
    return normalized.slice(workspace.length + 1)
  }

  return normalized.replace(/^\.\//u, '')
}

function sourceTestPath(file: string): string {
  return file.startsWith('dist/tests/') && file.endsWith('.js')
    ? file.slice('dist/'.length).replace(/\.js$/u, '.ts')
    : file
}

function failureKey(file: string, testCase: string): string {
  return `${sourceTestPath(file)}\u0000${testCase}`
}

/**
 * Classify each new test failure of a failing repository-check gate that is
 * absent from the baseline: `in_change_closure` when the stage's changed paths
 * import the test, else one isolated rerun with the profile's isolation command
 * that yields `reproduced`, `environment_or_flake`, or `isolation_unproven`, or
 * `isolation_unavailable` with a reason. Returns `reclassifiedPass` only when
 * every new diagnostic passed its rerun. Spawns rerun processes in the
 * workspace.
 */
export function classifyGateTestFailures(options: {
  root: string
  workspace: WorkspaceSnapshot
  /**
   * The snapshot this stage started from. A stage that commits its work leaves
   * a clean tree, so the dirty entries alone no longer describe what changed.
   */
  before?: WorkspaceSnapshot
  workspaceDir: string
  profileName: string
  criterion: Criterion
  baseline: RepositoryCheckResult
  current: RepositoryCheckResult
  comparison: ReturnType<typeof compareRepositoryCheckToBaseline>
}): {
  classifications: GateFailureClassification[]
  reclassifiedPass: boolean
  advisory: string | null
} {
  if (options.comparison.passed) {
    return { classifications: [], reclassifiedPass: false, advisory: null }
  }

  const currentFailures = repositoryCheckTestFailures(options.current)
  const baselineFailures = new Set(
    repositoryCheckTestFailures(options.baseline).map((failure) =>
      failureKey(
        relativeFailureFile(failure.file, options.workspaceDir),
        failure.case,
      ),
    ),
  )

  if (currentFailures.length === 0) {
    return { classifications: [], reclassifiedPass: false, advisory: null }
  }

  // The closure needs every path this stage touched, and a stage that commits
  // its work leaves none of them dirty. Without the absorbed paths the change
  // set empties at exactly the moment the classifier runs, and an empty change
  // set makes every failure look out of closure — the inverse of the guarantee.
  const changed = [
    ...new Set([
      ...options.workspace.entries.map(snapshotEntryPath),
      ...(options.before
        ? workspaceAbsorbedPathsFromSnapshots(options.before, options.workspace)
        : []),
    ]),
  ]
  let impacted = new Set<string>()
  let graphFiles = new Set<string>()

  try {
    const graph = buildModuleGraphByRegex(options.workspaceDir)
    const selection = selectImpactedTests(graph, changed)

    impacted = new Set(selection.selected)
    graphFiles = new Set(graph.files)
  } catch {
    // A missing graph is an unavailable diagnosis, never permission to pass.
  }

  // No change evidence is an unknown closure, not an empty one. Reclassifying
  // under it would reach its maximum precisely when the harness knows least,
  // so the gate keeps its failure and says why.
  const changeEvidence = changed.length > 0

  const isolationTemplate = loadRepositoryChecks(options.root).profiles[
    options.profileName
  ]?.isolation_command
  const classifications: GateFailureClassification[] = []
  const seenFailures = new Set<string>()

  for (const failure of currentFailures) {
    const isolatedFile = relativeFailureFile(failure.file, options.workspaceDir)
    const sourceFile = sourceTestPath(isolatedFile)
    const key = failureKey(isolatedFile, failure.case)

    if (seenFailures.has(key)) {
      continue
    }

    seenFailures.add(key)

    if (baselineFailures.has(key)) {
      continue
    }

    if (!changeEvidence || !graphFiles.has(sourceFile) || !isolationTemplate) {
      classifications.push({
        file: sourceFile,
        test: failure.case,
        initial_diagnostic: failure.diagnostic,
        disposition: 'isolation_unavailable',
        reason: !changeEvidence
          ? 'no_change_evidence'
          : graphFiles.has(sourceFile)
            ? 'no_isolation_command'
            : 'test_outside_import_graph',
      })
      continue
    }

    if (impacted.has(sourceFile)) {
      classifications.push({
        file: sourceFile,
        test: failure.case,
        initial_diagnostic: failure.diagnostic,
        disposition: 'in_change_closure',
      })
      continue
    }

    const command = substituteIsolationToken(
      substituteIsolationToken(
        substituteIsolationToken(isolationTemplate, '{file}', isolatedFile),
        '{test_pattern}',
        testNamePattern(failure.case),
      ),
      '{test}',
      failure.case,
    )
    const rerun = spawnSync(command, {
      cwd: options.workspaceDir,
      encoding: 'utf8',
      shell: true,
      timeout: options.criterion.timeout_ms ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: isolationEnvironment(),
    })

    const timedOut =
      isNodeError(rerun.error) && rerun.error.code === 'ETIMEDOUT'
    const cleanExit = rerun.status === 0 && !rerun.error

    // An exit code answers "did the command succeed", and the question here is
    // "did the failing test run and pass". Those differ whenever the selector
    // matches nothing, which is the normal outcome for a name carrying
    // regular-expression syntax.
    const executed = isolationExecutedTest(
      `${rerun.stdout ?? ''}\n${rerun.stderr ?? ''}`,
      failure.case,
    )
    const disposition: GateFailureClassification['disposition'] = !cleanExit
      ? 'reproduced'
      : executed
        ? 'environment_or_flake'
        : 'isolation_unproven'

    classifications.push({
      file: sourceFile,
      test: failure.case,
      initial_diagnostic: failure.diagnostic,
      disposition,
      ...(disposition === 'isolation_unproven'
        ? { reason: 'isolation_rerun_did_not_report_the_test' }
        : {}),
      isolation_command: command,
      isolation_exit_code: rerun.status,
      isolation_timed_out: timedOut,
      isolation_executed: executed,
    })
  }

  const reclassifiedDiagnostics = new Set(
    classifications
      .filter((entry) => entry.disposition === 'environment_or_flake')
      .map((entry) => entry.initial_diagnostic),
  )
  const substantive = options.comparison.delta.new.filter(
    (entry) => !entry.diagnostic.startsWith('<status>'),
  )

  const allFailingCommandsIdentified = options.current.results
    .filter((entry) => !entry.passed)
    .every(
      (entry) =>
        entry.kind === 'command' &&
        !entry.timed_out &&
        commandFailureDiagnostics(entry, options.current.workspace_root).some(
          (diagnostic) => parseTestFailureIdentity(diagnostic) !== null,
        ),
    )
  const reclassifiedPass =
    allFailingCommandsIdentified &&
    substantive.length > 0 &&
    substantive.every((entry) => reclassifiedDiagnostics.has(entry.diagnostic))

  const reclassified = classifications.filter(
    (entry) => entry.disposition === 'environment_or_flake',
  )
  const advisory =
    reclassified.length === 0
      ? null
      : reclassified
          .map(
            (entry) =>
              `Gate failure '${entry.file}::${entry.test}' failed in the ` +
              'profile and passed its one isolated rerun; classified as ' +
              '`environment_or_flake`.',
          )
          .join(' ')

  return { classifications, reclassifiedPass, advisory }
}

/**
 * Run one shell gate criterion and return its deterministic result. Resolves
 * the command and repository-check profile (the verification level may remap
 * the profile), reuses a matching gate-cache entry for the same workspace
 * fingerprint, else executes the command and writes a bounded and a full
 * evidence log to the run directory. A profile gate passes on diagnostic delta
 * against the run's baseline, with isolated reruns for new test failures; a
 * passing uncached result is stored in the gate cache.
 */
export function runShellCheck(
  root: string,
  runDirectory: string,
  state: RunState,
  stage: StageDefinition,
  criterion: Criterion,
  workspace: WorkspaceSnapshot,
  workspaceDir: string,
  commandOverride?: string,
  artifactId = stage.slug,
  onProgress?: (message: string) => void,
  options: { entryGate?: boolean; beforeSnapshot?: WorkspaceSnapshot } = {},
): DeterministicResult {
  const workspaceFingerprint = workspace.fingerprint
  const requestedCommand = commandOverride ?? criterion.command ?? ''
  const resolution = resolveShellCheck(
    root,
    criterion,
    requestedCommand,
    commandOverride !== undefined,
  )

  // The run's verification level may gate this criterion on a different
  // repository-check profile than the workflow declares. An explicit command
  // override still wins: resolution then carries no profile to remap.
  const levelRemap =
    resolution.profile_name !== null
      ? state.verification?.gates[criterion.id]
      : undefined
  const remappedProfile = typeof levelRemap === 'string' ? levelRemap : null
  const command = remappedProfile
    ? repositoryCheckGateCommand(remappedProfile)
    : resolution.command

  const startedAt = new Date().toISOString()
  const profileName = remappedProfile ?? resolution.profile_name

  // Resolve the baseline before any cache decision so a missing baseline still
  // fails the gate below.
  const baselineLoad =
    profileName && !resolution.removed_reason
      ? loadRepositoryCheckBaseline(root, state, profileName)
      : undefined

  // DEV-001. An operator override is run-scoped, so it stays uncached.
  const cacheKey =
    commandOverride === undefined &&
    !resolution.removed_reason &&
    gateCacheableSnapshot(workspace) &&
    !baselineLoad?.reason
      ? gateCacheKey(root, workspaceFingerprint, command)
      : null
  const cacheAcceptance = cacheKey
    ? gateCacheLookupForGate(root, cacheKey)
    : { entry: null, rejected_entry: null, rejection: null }
  const cached = cacheAcceptance.entry
  const cacheRejection = cacheAcceptance.rejection

  // A profile gate needs the recorded repository result for this run's delta.
  const cachedUsable =
    cached !== null && (!profileName || cached.repository_result !== undefined)
  let cachedSourceEvidence: string | null = null

  if (cached && cachedUsable) {
    try {
      cachedSourceEvidence = readFileSync(
        path.join(root, cached.evidence_path),
        'utf8',
      )
    } catch {
      cachedSourceEvidence = null
    }
  }

  if (cached && cachedUsable && cachedSourceEvidence !== null) {
    const cachedSafeId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
    const cachedEvidencePath = path.join(
      runDirectory,
      'evidence',
      `${artifactId}-${cachedSafeId}.log`,
    )
    const cachedComparison =
      profileName && cached.repository_result && baselineLoad?.result
        ? compareRepositoryCheckToBaseline(
            baselineLoad.result,
            cached.repository_result,
            baselineLoad.workspace_divergence ?? null,
          )
        : undefined
    const explanation =
      `Accepted cached clean pass of the same command at an unchanged ` +
      `workspace fingerprint, recorded ${cached.cached_at} by run ` +
      `${cached.run_id} (criterion ${cached.criterion_id}). Original ` +
      `evidence: ${cached.evidence_path}.` +
      (cachedComparison ? ` ${cachedComparison.explanation}` : '')

    onProgress?.(
      `${criterion.id} accepted cached pass recorded ${cached.cached_at} ` +
        `by ${cached.run_id}`,
    )
    // Copy the original output because archival can move the source run.
    writeTextAtomic(
      cachedEvidencePath,
      [
        `$ ${command}`,
        'cached=true',
        `cached_at=${cached.cached_at}`,
        `source_run=${cached.run_id}`,
        `source_criterion=${cached.criterion_id}`,
        `source_evidence=${cached.evidence_path}`,
        `workspace_fingerprint=${workspaceFingerprint}`,
        'exit_code=0',
        '',
        explanation,
        '',
        '--- source evidence ---',
        cachedSourceEvidence,
      ].join('\n'),
    )

    // The profile recorded with the original execution stands in for a
    // re-profile the cached pass never performs.
    const cachedSuiteProfile =
      cached.suite_profile_path &&
      fileExists(path.join(root, cached.suite_profile_path))
        ? cached.suite_profile_path
        : undefined

    return {
      id: criterion.id,
      type: 'shell',
      hard: Boolean(criterion.hard),
      passed: cachedComparison ? cachedComparison.passed : true,
      cached: true,
      ...(cachedSuiteProfile ? { suite_profile_path: cachedSuiteProfile } : {}),
      explanation,
      ...(cachedComparison
        ? { repository_check_delta: cachedComparison.delta }
        : {}),
      ...(remappedProfile && state.verification
        ? { verification_level: state.verification.level }
        : {}),
      command,
      exit_code: 0,
      timed_out: false,
      evidence_path: path
        .relative(root, cachedEvidencePath)
        .split(path.sep)
        .join('/'),
      ...(baselineLoad?.artifact_path
        ? { baseline_evidence_path: baselineLoad.artifact_path }
        : {}),
      workspace_fingerprint: workspaceFingerprint,
    }
  }

  if (cacheRejection) {
    onProgress?.(cacheRejection)
  }

  let exitCode: number | null
  let signal: NodeJS.Signals | null = null
  let stdout: string
  let stderr: string

  let errorMessageText = ''
  let timedOut = false
  let skipped = false
  let repositoryResult: RepositoryCheckResult | undefined

  // Only the `full` profile is profiled: it is the last suite execution before
  // ship. Baselines, interior gates, and agent-side runs never set the
  // variable. The artifact exists only when the profile ran the reporter.
  const suiteProfileTarget =
    profileName === SUITE_PROFILE_GATE_PROFILE
      ? suiteProfileEvidencePath(runDirectory, artifactId)
      : null

  if (resolution.removed_reason) {
    exitCode = 0
    stdout = `${resolution.removed_reason}\n`
    stderr = ''
    skipped = true
  } else if (profileName) {
    onProgress?.(
      `running ${criterion.id} with repository profile '${profileName}' (timeout ${criterion.timeout_ms ?? 'default'}ms)`,
    )
    // Profile gates run where the stage worked, so a worktree-targeted run is
    // judged by its own workspace rather than the main checkout.
    const loadAverage = loadavg()[0] ?? 0
    repositoryResult = runRepositoryCheck(root, profileName, {
      timeout_ms: criterion.timeout_ms,
      workspace: workspaceDir,
      env: {
        [FAST_WALL_SERIES_ROOT_ENV]: root,
        [FAST_WALL_RUN_ID_ENV]: state.run_id,
        [FAST_WALL_PHASE_ENV]: criterion.id,
        [FAST_WALL_CALLER_CLASS_ENV]: 'harness_gate',
        ...(suiteProfileTarget
          ? { [TEST_PROFILE_ENV]: suiteProfileTarget }
          : {}),
      },
    })
    onProgress?.(
      `${criterion.id} ${repositoryResult.status} in ${(repositoryResult.total_duration_ms / 1000).toFixed(1)}s`,
    )
    appendTargetFastWallRun({
      root,
      profile: profileName,
      status: repositoryResult.status,
      wall_clock_ms: repositoryResult.total_duration_ms,
      load_average: loadAverage,
      cpu_count: availableParallelism(),
      workspace_fingerprint: workspaceFingerprint,
      run_id: state.run_id,
      phase: criterion.id,
    })

    exitCode = repositoryResult.status === 'failed' ? 1 : 0
    stdout = `${JSON.stringify(repositoryResult, null, 2)}\n`
    stderr = ''
    skipped = repositoryResult.status === 'not_configured'
    timedOut = repositoryResult.results.some((result) => result.timed_out)
  } else {
    onProgress?.(
      `running ${criterion.id} command (timeout ${criterion.timeout_ms ?? 120_000}ms)`,
    )
    const commandStartedAt = Date.now()
    const result = spawnSync(command, {
      cwd: workspaceDir,
      encoding: 'utf8',
      shell: true,
      timeout: criterion.timeout_ms ?? 120_000,
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PAN_WORKFLOW_STAGE: stage.slug,
        PANCREATOR_ROOT: root,
        PAN_WORKSPACE_ROOT: workspaceDir,
      },
    })

    onProgress?.(
      `${criterion.id} ${result.status === 0 ? 'passed' : 'failed'} in ${((Date.now() - commandStartedAt) / 1000).toFixed(1)}s`,
    )
    exitCode = result.status
    signal = result.signal
    stdout = result.stdout ?? ''
    stderr = result.stderr ?? ''
    errorMessageText = result.error?.message ?? ''
    timedOut = isNodeError(result.error) && result.error.code === 'ETIMEDOUT'
    skipped = stdout.includes('PANCREATOR_CHECK_SKIPPED=1')
  }

  let baselineComparison:
    | ReturnType<typeof compareRepositoryCheckToBaseline>
    | undefined
  let baselineEvidencePath: string | undefined
  let baselineGap: string | undefined
  let baselineResult: RepositoryCheckResult | undefined

  // Baseline parity applies to every repository-check gate the run baselined,
  // not only to a gate that happens to be failing. A stage that repairs an
  // inherited failure needs the credit recorded, and a first-time failure needs
  // to be named as new rather than inferred from an exit code.
  if (profileName && repositoryResult && !skipped) {
    const load =
      baselineLoad ?? loadRepositoryCheckBaseline(root, state, profileName)

    if (load.result) {
      baselineResult = load.result
      baselineComparison = compareRepositoryCheckToBaseline(
        load.result,
        repositoryResult,
        load.workspace_divergence ?? null,
      )
      baselineEvidencePath = load.artifact_path
    } else if (load.reason) {
      baselineGap = load.reason
    }
  }

  const failureClassification =
    profileName &&
    repositoryResult &&
    baselineResult &&
    baselineComparison &&
    !skipped
      ? classifyGateTestFailures({
          root,
          workspace,
          ...(options.beforeSnapshot ? { before: options.beforeSnapshot } : {}),
          workspaceDir,
          profileName,
          criterion,
          baseline: baselineResult,
          current: repositoryResult,
          comparison: baselineComparison,
        })
      : { classifications: [], reclassifiedPass: false, advisory: null }

  if (failureClassification.advisory && repositoryResult) {
    repositoryResult.advisories.push(failureClassification.advisory)
  }

  if (failureClassification.classifications.length > 0) {
    stdout +=
      '\n--- failure classifications ---\n' +
      `${JSON.stringify(failureClassification.classifications, null, 2)}\n`
  }

  // A gate with no baseline is judged on its own exit code. That is correct —
  // a verification level baselines only the source-mutating profiles — but the
  // failure it produces looks identical to a regression the run introduced,
  // and a reader who assumes baseline parity spends the next stage hunting for
  // a change that never happened. The failure says which judgment it made and
  // which profiles the run actually baselined, so inherited debt is
  // recognizable as inherited.
  const judgedAbsolutely = Boolean(
    profileName && repositoryResult && !skipped && !baselineComparison,
  )
  // An entry gate runs before the run owns a baseline for its profile, so a
  // test the operator already knew was broken would stop the run at the door
  // with no way to say so short of disabling the gate. A declaration is that
  // way to say so, and it is narrow: it credits the exact cases it names and
  // nothing else, so the gate still catches everything the run broke.
  const knownFailing =
    options.entryGate === true && repositoryResult && !skipped
      ? creditKnownFailures(
          repositoryResult,
          state.request.known_failing_tests ?? [],
        )
      : null
  const creditedAsBaseline = Boolean(
    knownFailing &&
    knownFailing.credited.length > 0 &&
    knownFailing.undeclared.length === 0,
  )

  const safeCriterionId = criterion.id.replaceAll(/[^a-zA-Z0-9_.-]/g, '-')
  const evidencePath = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${safeCriterionId}.log`,
  )
  const fullEvidencePath = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${safeCriterionId}.full.log`,
  )

  const boundedStdout = boundEvidenceStream(stdout)
  const boundedStderr = boundEvidenceStream(stderr)
  const elided = boundedStdout !== stdout || boundedStderr !== stderr

  const header = [
    `$ ${command}`,
    `started_at=${startedAt}`,
    `finished_at=${new Date().toISOString()}`,
    `workspace_fingerprint=${workspaceFingerprint}`,
    `exit_code=${exitCode ?? 'null'}`,
    cacheRejection ? `cache_rejection=${cacheRejection}` : null,
    signal ? `signal=${signal}` : null,
  ].filter((line): line is string => line !== null)
  const body = (out: string, err: string, note: string | null) =>
    [
      ...header,
      ...(note ? [note] : []),
      '',
      '--- stdout ---',
      out,
      '--- stderr ---',
      err,
      errorMessageText ? `--- error ---\n${errorMessageText}` : '',
    ].join('\n')

  // Full test-suite transcripts run to megabytes each and dominate a run's
  // on-disk size while the actionable content sits at the head and tail. Keep a
  // bounded log as the referenced evidence and the untruncated one beside it.
  if (elided) {
    writeTextAtomic(fullEvidencePath, body(stdout, stderr, null))
  }

  writeTextAtomic(
    evidencePath,
    body(
      boundedStdout,
      boundedStderr,
      elided ? `full_output=${toRepoRelative(root, fullEvidencePath)}` : null,
    ),
  )

  const commandSucceeded = exitCode === 0 && !errorMessageText
  const passed = baselineGap
    ? false
    : !skipped &&
      (baselineComparison
        ? baselineComparison.passed || failureClassification.reclassifiedPass
        : commandSucceeded || creditedAsBaseline)
  const inheritedFailureOnly = Boolean(
    (baselineComparison?.passed && !commandSucceeded) || creditedAsBaseline,
  )
  const classificationExplanation = failureClassification.reclassifiedPass
    ? (failureClassification.advisory ??
      'Every new gate failure passed its one isolated rerun.')
    : null

  const suiteProfilePath =
    suiteProfileTarget && repositoryResult && fileExists(suiteProfileTarget)
      ? path.relative(root, suiteProfileTarget).split(path.sep).join('/')
      : undefined

  // Cache only a clean pass. A baseline-relative pass credits this run's own
  // baseline.
  if (cacheKey && passed && commandSucceeded && !skipped && !timedOut) {
    gateCacheStore(
      root,
      buildGateCacheEntry({
        key: cacheKey,
        criterion_id: criterion.id,
        command,
        workspace_fingerprint: workspaceFingerprint,
        run_id: state.run_id,
        evidence_path: path
          .relative(root, evidencePath)
          .split(path.sep)
          .join('/'),
        recorded_by: 'harness',
        ...(repositoryResult ? { repository_result: repositoryResult } : {}),
        suite_profile_path: suiteProfilePath ?? null,
      }),
    )
  }
  const environmentBlocked = isEnvironmentBlockedDelta(
    stage,
    baselineResult,
    baselineComparison,
  )
  const failedLanes =
    !passed && repositoryResult?.status === 'failed'
      ? failedRepositoryCheckLanes(repositoryResult)
      : []

  return {
    id: criterion.id,
    type: 'shell',
    hard: Boolean(criterion.hard),
    passed,
    ...(baselineGap
      ? { explanation: `${baselineGap} The gate fails closed.` }
      : skipped
        ? {
            disabled: true,
            explanation:
              resolution.removed_reason ??
              'Repository check profile is not configured; no technology-specific command was guessed.',
          }
        : baselineComparison
          ? {
              explanation:
                classificationExplanation ?? baselineComparison.explanation,
              repository_check_delta: baselineComparison.delta,
              ...(inheritedFailureOnly ? { preexisting_failure: true } : {}),
              ...(environmentBlocked ? { environment_blocked: true } : {}),
            }
          : creditedAsBaseline
            ? {
                preexisting_failure: true,
                explanation:
                  `Every failure this gate observed was declared known-failing ` +
                  `by the run request, so it is reported as baseline: ` +
                  `${knownFailing?.credited.join('; ')}.`,
              }
            : judgedAbsolutely && !passed
              ? {
                  explanation: [
                    ...(repositoryResult?.advisories ?? []),
                    ...(knownFailing && knownFailing.credited.length > 0
                      ? [
                          `${knownFailing.credited.length} declared ` +
                            `known-failing case(s) were credited, but ` +
                            `${knownFailing.undeclared.length} undeclared ` +
                            `diagnostic(s) remain: ` +
                            `${knownFailing.undeclared.join('; ')}.`,
                        ]
                      : []),
                    absoluteJudgingDisclosure(state, profileName as string),
                  ].join(' '),
                }
              : repositoryResult?.advisories.length
                ? { explanation: repositoryResult.advisories.join(' ') }
                : {}),
    ...(commandOverride === undefined
      ? {}
      : {
          overridden: true,
          explanation: 'Gate command was overridden by run configuration.',
        }),
    ...(criterion.id === FAST_WALL_CRITERION_ID && stdout.trim().length > 0
      ? { explanation: stdout.trim() }
      : {}),
    ...(remappedProfile && state.verification
      ? { verification_level: state.verification.level }
      : {}),
    command,
    exit_code: exitCode,
    timed_out: timedOut,
    evidence_path: path.relative(root, evidencePath).split(path.sep).join('/'),
    ...(baselineEvidencePath
      ? { baseline_evidence_path: baselineEvidencePath }
      : {}),
    ...(suiteProfilePath ? { suite_profile_path: suiteProfilePath } : {}),
    ...(failureClassification.classifications.length > 0
      ? { failure_classifications: failureClassification.classifications }
      : {}),
    ...(failedLanes.length > 0 ? { failed_lanes: failedLanes } : {}),
    workspace_fingerprint: workspaceFingerprint,
  }
}
