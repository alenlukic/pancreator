/** Tune audit table parsing and validation. */

import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { identityKey, tuneSessionWorkDir, type TuneVerdict } from './record.js'
import { assertSelfDevelopment, collectBaselineInventory } from './inventory.js'

export interface AuditRow {
  file: string
  name: string
  introducing_commit?: string
  verdict: TuneVerdict
  principle: string
  rationale: string
  survivor?: string
  demote_destination?: string
  delete_reason?: string
}

export interface ValidateAuditOptions {
  recordPath: string
  baselineRef: string
  targetRef: string
  json?: boolean
}

export interface ValidateAuditResult {
  complete: boolean
  baseline_count: number
  fast_count: number
  secondary_count: number
  delta_count: number
  missing: string[]
  unexpected: string[]
  duplicates: string[]
}

function parseAuditMarkdown(content: string): AuditRow[] {
  const rows: AuditRow[] = []
  const lines = content.split('\n')
  let current: Partial<AuditRow> | null = null

  for (const line of lines) {
    const heading = /^### `([^`]+)` :: (.+)$/u.exec(line)

    if (heading) {
      if (
        current?.file &&
        current.name &&
        current.verdict &&
        current.principle
      ) {
        rows.push(current as AuditRow)
      }

      current = { file: heading[1], name: heading[2] }
      continue
    }

    if (!current) {
      continue
    }

    const verdict = /^- \*\*Verdict:\*\* (.+)$/u.exec(line)

    if (verdict) {
      current.verdict = verdict[1] as TuneVerdict
      continue
    }

    const principle = /^- \*\*Principle:\*\* (.+)$/u.exec(line)

    if (principle) {
      current.principle = principle[1]
      continue
    }

    const rationale = /^- \*\*Rationale:\*\* (.+)$/u.exec(line)

    if (rationale) {
      current.rationale = rationale[1]
    }
  }

  if (current?.file && current.name && current.verdict && current.principle) {
    rows.push(current as AuditRow)
  }

  return rows
}

/**
 * Checks that an audit Markdown record has exactly one row per test added
 * between the baseline and target refs, reporting missing, unexpected, and
 * duplicate rows and whether the audit is complete. Throws
 * `TUNE_SELF_DEVELOPMENT_ONLY` outside self-development.
 *
 * Slow and side-effecting: each ref's inventory is collected in a temporary
 * detached Git worktree that runs `npm ci` and a build, and both session work
 * directories are deleted afterwards.
 */
export function validateAudit(
  root: string,
  options: ValidateAuditOptions,
): ValidateAuditResult {
  assertSelfDevelopment(root)

  const content = readFileSync(
    path.isAbsolute(options.recordPath)
      ? options.recordPath
      : path.join(root, options.recordPath),
    'utf8',
  )
  const rows = parseAuditMarkdown(content)

  const baselineSession = `audit-${Date.now()}`
  const baseline = collectBaselineInventory(
    root,
    options.baselineRef,
    baselineSession,
  )

  const target = execFileSync('git', ['rev-parse', options.targetRef], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const targetSession = `audit-target-${Date.now()}`
  const targetInventory = collectBaselineInventory(root, target, targetSession)
  rmSync(tuneSessionWorkDir(root, baselineSession), {
    recursive: true,
    force: true,
  })
  rmSync(tuneSessionWorkDir(root, targetSession), {
    recursive: true,
    force: true,
  })

  const baselineKeys = new Set(baseline.map(identityKey))
  const delta = targetInventory.filter(
    (item) => !baselineKeys.has(identityKey(item)),
  )

  const rowKeys = rows.map((row) =>
    identityKey({
      file: row.file,
      name: row.name,
      lane: 'unknown',
    }),
  )
  const rowKeySet = new Set(rowKeys)
  const deltaKeys = new Set(delta.map(identityKey))

  const missing = [...deltaKeys].filter((key) => !rowKeySet.has(key))
  const unexpected = [...rowKeySet].filter((key) => !deltaKeys.has(key))

  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const key of rowKeys) {
    if (seen.has(key)) {
      duplicates.push(key)
    }

    seen.add(key)
  }

  const fast_count = baseline.filter((item) => item.lane !== 'secondary').length
  const secondary_count = baseline.filter(
    (item) => item.lane === 'secondary',
  ).length

  return {
    complete:
      missing.length === 0 &&
      unexpected.length === 0 &&
      duplicates.length === 0,
    baseline_count: baseline.length,
    fast_count,
    secondary_count,
    delta_count: delta.length,
    missing,
    unexpected,
    duplicates,
  }
}
