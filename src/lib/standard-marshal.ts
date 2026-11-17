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

/** A narrow, dependency-free proof of a shape-only edit. The entire test body,
 * including assertion operands, control flow, comments and fixtures, must stay
 * identical. Only static named imports of the implementation may be rebound
 * while preserving every local binding. An unrecognized edit is not proof of
 * semantic equivalence: restore the authored tests or return to planning. */
function namedImport(
  line: string,
): { bindings: { imported: string; local: string }[]; module: string } | null {
  const match = line.match(
    /^\s*import\s*\{([^{}]+)\}\s*from\s*(['"])(\.{1,2}\/[a-zA-Z0-9_./-]+)\2\s*;?\s*$/u,
  )
  if (!match) return null
  const entries = match[1]!
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  if (!entries.length) return null
  const bindings: { imported: string; local: string }[] = []
  for (const entry of entries) {
    const binding = entry.match(
      /^([a-zA-Z_$][\w$]*)(?:\s+as\s+([a-zA-Z_$][\w$]*))?$/u,
    )
    if (!binding) return null
    bindings.push({ imported: binding[1]!, local: binding[2] ?? binding[1]! })
  }
  if (
    new Set(bindings.map((binding) => binding.local)).size !== bindings.length
  )
    return null
  return { bindings, module: match[3]! }
}

/** Restrict edits to a real initial import header. A body line that happens to
 * look like an import (inside a string, comment or nested scope) is not eligible. */
export function isShapeOnlyMarshal(
  before: string,
  after: string,
  relative: string,
): boolean {
  if (before === after) return true
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/u.test(relative)) return false
  const original = before.split(/\r?\n/u)
  const current = after.split(/\r?\n/u)
  if (original.length !== current.length) return false
  let header = true
  for (const [index, line] of original.entries()) {
    const next = current[index]!
    if (
      header &&
      !/^\s*(?:$|\/\/)/u.test(line) &&
      !/^\s*import\s+(?:[a-zA-Z_$][\w$]*|\*\s+as\s+[a-zA-Z_$][\w$]*|\{[a-zA-Z0-9_$,\s]+\})\s+from\s+(['"])[^'"\\]+\1\s*;?\s*$/u.test(
        line,
      )
    )
      header = false
    if (line === next) continue
    if (!header) return false
    const oldImport = namedImport(line)
    const newImport = namedImport(next)
    if (
      !oldImport ||
      !newImport ||
      oldImport.module !== newImport.module ||
      JSON.stringify(oldImport.bindings.map((binding) => binding.local)) !==
        JSON.stringify(newImport.bindings.map((binding) => binding.local))
    )
      return false
    // Rebinding an assertion helper or a test registration function would
    // preserve the text of the body while changing its meaning. Only direct
    // subject calls assigned to a local value are recognized automatically.
    const subject = path.posix.normalize(
      path.posix.join(path.posix.dirname(relative), oldImport.module),
    )
    if (
      subject.startsWith('../') ||
      subject
        .split('/')
        .some((part) =>
          /^(?:tests?|__tests__|fixtures?|__mocks__)$/iu.test(part),
        )
    )
      return false
    for (const [position, binding] of oldImport.bindings.entries()) {
      if (binding.imported === newImport.bindings[position]!.imported) continue
      const escaped = binding.local.replace(/\$/gu, '\\$')
      const occurrence = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'gu')
      const assignment = new RegExp(
        `^\\s*const\\s+[a-zA-Z_$][\\w$]*\\s*=\\s*${escaped}\\s*\\(`,
        'u',
      )
      const uses = original
        .slice(index + 1)
        .filter((bodyLine) => [...bodyLine.matchAll(occurrence)].length > 0)
      if (
        !uses.length ||
        uses.some(
          (bodyLine) =>
            !assignment.test(bodyLine) ||
            [...bodyLine.matchAll(occurrence)].length !== 1,
        )
      )
        return false
    }
  }
  return true
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
    return isShapeOnlyMarshal(file.content, readText(current), file.path)
      ? []
      : [
          `Cannot prove shape-only reconciliation in ${file.path}; preserve the complete authored test body and fixtures. Restore them or return to planning for a reviewed contract amendment; route behavior changes to remediation.`,
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
