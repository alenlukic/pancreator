/** Capture the independently authored tests before the source-allowed join. */
import path from 'node:path'
import { invariant } from './errors.js'
import { gitWorkspaceSnapshot } from './git.js'
import { AGENT_REPOSITORY_CHECK_RUNS_FILE } from './repository-checks/ledger.js'
import { resolveRunLayout } from './run-layout.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
} from './io.js'
import {
  evidenceWorkerAttempts,
  readEvidenceReportState,
} from './render/delivery-prompt.js'
import type { Invocation } from './types.js'

export function marshalBaselinePath(
  root: string,
  invocation: Invocation,
): string {
  return resolveInside(root, `${invocation.output.path}.marshal-baseline.json`)
}

export function captureMarshalBaseline(
  root: string,
  invocation: Invocation,
): void {
  if (
    invocation.workflow.slug !== 'standard' ||
    invocation.stage.slug !== 'implement'
  )
    return
  const destination = marshalBaselinePath(root, invocation)
  if (fileExists(destination)) return
  const worker = invocation.evidence_workers?.find(
    (item) => item.role === 'test-author',
  )
  invariant(worker, 'Standard implement requires the test author.')
  const attempt = evidenceWorkerAttempts(worker).at(-1)!
  const report = readText(resolveInside(root, attempt.evidence_path))
  const state = readEvidenceReportState(report)
  invariant(
    state.complete && state.verdict === 'pass',
    'Test-author report must be complete and pass before marshaling.',
  )
  const paths = [
    ...new Set(
      [...report.matchAll(/^<!-- marshal-test: (.+) -->$/gmu)].map((match) =>
        match[1]!.trim(),
      ),
    ),
  ]
  const noChanges = /^<!-- marshal-tests: none -->$/mu.test(report)
  invariant(
    (paths.length > 0 && !noChanges) || (paths.length === 0 && noChanges),
    'Test-author report must declare changed test and fixture paths or explicitly declare no changes.',
  )
  const workspace = path.resolve(root, invocation.workspace_root)
  const files = paths.map((relative) => {
    invariant(
      !path.isAbsolute(relative),
      'Marshaling baseline requires relative test paths.',
    )
    return {
      path: relative,
      content: readText(resolveInside(workspace, relative)),
    }
  })
  writeJsonAtomic(destination, {
    files,
    fingerprint: gitWorkspaceSnapshot(workspace).fingerprint,
  })
}

/** Conservative cross-language guard: preserve assertion and test registration
 * lines verbatim, including continuation lines for parenthesized expressions.
 * The review still judges fixture and behavioral equivalence. */
export function protectedTestLines(source: string): string[] {
  const protectedLines: string[] = []
  let depth = 0
  for (const line of source.split(/\r?\n/u)) {
    const starts =
      /\b(?:assert(?:[._\w]*|ion)|expect|test|it|describe|pytest\.raises|require\.[\w]+)\s*\(/u.test(
        line,
      ) ||
      /\b(?:assert|def test_)[\s\w]/u.test(line) ||
      /^\s*\.(?:to\w*|not|resolves|rejects|and|with)\b/u.test(line)
    if (starts || depth > 0) {
      protectedLines.push(line.trim())
      depth = Math.max(
        0,
        depth +
          (line.match(/\(/gu)?.length ?? 0) -
          (line.match(/\)/gu)?.length ?? 0),
      )
      // A test registration opens a callback; protect its declaration, not its body.
      if (starts && /=>\s*\{|function\s*\([^)]*\)\s*\{/u.test(line)) depth = 0
    }
  }
  return protectedLines
}

export function marshalBaselineViolations(
  root: string,
  invocation: Invocation,
): string[] {
  const baseline = marshalBaselinePath(root, invocation)
  if (!fileExists(baseline))
    return [
      'Missing pre-join test baseline. Complete the evidence watch before launching the join.',
    ]
  const value = readJson(baseline) as {
    files: Array<{ path: string; content: string }>
  }
  const workspace = path.resolve(root, invocation.workspace_root)
  return value.files.flatMap((file) => {
    const current = resolveInside(workspace, file.path)
    if (!fileExists(current))
      return [`Deleted authored test or fixture: ${file.path}`]
    const before = protectedTestLines(file.content)
    const after = protectedTestLines(readText(current))
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : [
          `Changed assertion or scenario registration in ${file.path}; route behavior changes to remediation.`,
        ]
  })
}

/** New runs permit test changes only after a failed check on the untouched pair. */
export function contractReconciliationViolations(
  root: string,
  invocation: Invocation,
  marshaling: unknown,
): string[] {
  const baseline = marshalBaselinePath(root, invocation)
  if (!fileExists(baseline)) return ['Missing pre-join test baseline.']
  const value = readJson(baseline) as {
    files: Array<{ path: string; content: string }>
    fingerprint?: string
  }
  const workspace = path.resolve(root, invocation.workspace_root)
  const changed = value.files
    .filter((file) => {
      const current = resolveInside(workspace, file.path)
      return !fileExists(current) || readText(current) !== file.content
    })
    .map((file) => file.path)
  const edits =
    isRecord(marshaling) && Array.isArray(marshaling.edits)
      ? marshaling.edits
      : []
  if (!changed.length && !edits.length) return []
  const violations: string[] = []
  const paths = new Set(
    edits.flatMap((edit) =>
      isRecord(edit) && typeof edit.path === 'string' ? [edit.path] : [],
    ),
  )
  if (
    changed.some((file) => !paths.has(file)) ||
    [...paths].some((file) => !changed.includes(file))
  ) {
    violations.push(
      'Reconciliation edits MUST identify exactly the changed authored test and fixture paths.',
    )
  }
  if (
    !isRecord(marshaling) ||
    typeof marshaling.mismatch !== 'string' ||
    !marshaling.mismatch.trim() ||
    typeof marshaling.check_profile !== 'string' ||
    !['impacted', 'static'].includes(marshaling.check_profile)
  ) {
    violations.push(
      'Test reconciliation requires a concrete interface mismatch and its failed configured check profile.',
    )
    return violations
  }
  const ledger = resolveRunLayout(root, invocation.run_id).evidence(
    AGENT_REPOSITORY_CHECK_RUNS_FILE,
  ).absolute
  const failed =
    fileExists(ledger) &&
    readText(ledger)
      .split('\n')
      .some((line) => {
        try {
          const record: unknown = JSON.parse(line)
          return (
            isRecord(record) &&
            record.invocation_id === invocation.invocation_id &&
            record.profile === marshaling.check_profile &&
            record.status === 'failed' &&
            typeof value.fingerprint === 'string' &&
            record.workspace_fingerprint === value.fingerprint
          )
        } catch {
          return false
        }
      })
  if (!failed)
    violations.push(
      'No failed configured check is recorded at the pre-join workspace fingerprint for this invocation.',
    )
  return violations
}
