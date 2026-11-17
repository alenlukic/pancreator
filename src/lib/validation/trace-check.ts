import path from 'node:path'
import { errorMessage } from '../errors.js'
import { gitWorkspaceSnapshot } from '../git.js'
import { isRecord, sha256, toRepoRelative, writeJsonAtomic } from '../io.js'
import {
  loadRepositoryChecks,
  runRepositoryCheck,
  type RepositoryCheckResult,
} from '../repository-checks.js'
import {
  traceArtifactDigests,
  traceArtifactPath,
  traceArtifactPaths,
} from '../trace-artifacts.js'
import type {
  Criterion,
  DeterministicResult,
  StageOutput,
  WorkspaceSnapshot,
} from '../types.js'

export const TRACE_CHECK_ID = 'trace.tests_run'
const TRACE_PROFILE = 'trace'
const TRACE_FILE_ENV = 'PANCREATOR_TRACE_TEST_FILE'

/** A passing file-level Node TAP subtest can mean the file registered no
 * tests. Neither that nor a skipped/todo scenario proves trace behavior. */
function nodeTraceDidNotRun(transcript: string, file: string): boolean {
  if (/node:test run\(\) is being called recursively/u.test(transcript))
    return true
  if (
    !/^TAP version 13$/mu.test(transcript) ||
    !/^# tests \d+$/mu.test(transcript)
  )
    return false
  const count = (label: string) =>
    Number(transcript.match(new RegExp(`^# ${label} (\\d+)$`, 'mu'))?.[1] ?? 0)
  const names = [...transcript.matchAll(/^\s*# Subtest: (.+)$/gmu)].map(
    (match) => match[1]!,
  )
  const compiled = `dist/${file.replace(/\.ts$/u, '.js')}`
  return (
    count('pass') === 0 ||
    count('skipped') > 0 ||
    count('todo') > 0 ||
    names.length === 0 ||
    names.every((name) =>
      [file, compiled].some(
        (candidate) => name === candidate || name.endsWith(`/${candidate}`),
      ),
    )
  )
}

/** A trace must prove every declared test file passes in the submitted tree.
 * The target owns the runner; worker output supplies paths, never commands.
 * No baseline credit, profile remapping or cache can substitute for execution. */
export function runTraceCheck(
  root: string,
  runDirectory: string,
  criterion: Criterion,
  workspace: WorkspaceSnapshot,
  workspaceDir: string,
  artifactId: string,
  output?: StageOutput,
): DeterministicResult {
  const evidence = path.join(
    runDirectory,
    'evidence',
    `${artifactId}-${TRACE_CHECK_ID}.json`,
  )
  const results: Array<{ file: string; result: RepositoryCheckResult }> = []
  let error: string | undefined
  try {
    const profile = loadRepositoryChecks(root).profiles[TRACE_PROFILE]
    if (
      !profile?.commands.some(
        (command) =>
          command.includes(`$${TRACE_FILE_ENV}`) ||
          command.includes(`\${${TRACE_FILE_ENV}}`),
      )
    ) {
      throw new Error(
        `Configure repository-check profile '${TRACE_PROFILE}' to execute the file in $${TRACE_FILE_ENV}. A static or unrelated suite pass cannot prove trace tests ran.`,
      )
    }
    if (!isRecord(output?.data)) throw new Error('Missing trace output data')
    const files = traceArtifactPaths(output.data, 'trace_tests')
    const before = traceArtifactDigests(workspaceDir, output.data)
    const deadline = Date.now() + (criterion.timeout_ms ?? 300_000)
    for (const file of files) {
      const remaining = deadline - Date.now()
      if (remaining < 1000)
        throw new Error('Trace test gate exhausted its time budget')
      traceArtifactPath(workspaceDir, file)
      const result = runRepositoryCheck(root, TRACE_PROFILE, {
        workspace: workspaceDir,
        timeout_ms: remaining,
        env: { [TRACE_FILE_ENV]: `./${file}` },
      })
      results.push({ file, result })
      if (
        result.status !== 'passed' ||
        result.results.some(
          (entry) =>
            entry.kind === 'command' &&
            nodeTraceDidNotRun(`${entry.stdout}\n${entry.stderr}`, file),
        )
      ) {
        throw new Error(`Trace tests failed, skipped, or did not run: ${file}`)
      }
    }
    if (
      sha256(before) !==
        sha256(traceArtifactDigests(workspaceDir, output.data)) ||
      gitWorkspaceSnapshot(workspaceDir).fingerprint !== workspace.fingerprint
    ) {
      throw new Error(
        'Workspace or trace artifacts changed during trace execution; submit a stable tree.',
      )
    }
  } catch (failure) {
    error = errorMessage(failure)
  }
  writeJsonAtomic(evidence, {
    workspace_fingerprint: workspace.fingerprint,
    results,
    ...(error ? { error } : {}),
  })
  return {
    id: criterion.id,
    type: 'shell',
    hard: true,
    passed: error === undefined,
    explanation:
      error ?? `All ${results.length} declared trace test files passed.`,
    command: criterion.command,
    evidence_path: toRepoRelative(root, evidence),
    workspace_fingerprint: workspace.fingerprint,
  }
}
