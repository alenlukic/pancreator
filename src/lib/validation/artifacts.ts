/**
 * Invocation, delegation, and attestation artifact paths, and the validation
 * artifact shape the validators build and load.
 */

import { rmSync } from 'node:fs'
import path from 'node:path'

import {
  resolveInside,
  fileExists,
  ensureDir,
  writeTextAtomic,
  readText,
  readJson,
  isRecord,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import type {
  ExternalDelegationRecord,
  Invocation,
  InvocationDeliveryMode,
} from '../types.js'

export const POLICIES_HEADING = '## 📜 Policies in force'
export const PRIOR_FAILURE_HEADING = '## ⛔ Why the previous attempt failed'

/** Head and tail bytes preserved per stream in a deterministic-gate evidence log. */
const EVIDENCE_STREAM_HEAD_BYTES = 64 * 1024
const EVIDENCE_STREAM_TAIL_BYTES = 16 * 1024

export function boundEvidenceStream(value: string): string {
  const budget = EVIDENCE_STREAM_HEAD_BYTES + EVIDENCE_STREAM_TAIL_BYTES

  if (value.length <= budget) {
    return value
  }

  return [
    value.slice(0, EVIDENCE_STREAM_HEAD_BYTES),
    `\n…[${value.length - budget} bytes elided; see the full log beside this one]…\n`,
    value.slice(value.length - EVIDENCE_STREAM_TAIL_BYTES),
  ].join('')
}
export const DELEGATION_HEADING = '## 🧭 Supervisor delivery procedure'
export const AGENT_REQUIREMENTS_HEADING = '## ✅ Agent validation requirements'
export const HARNESS_REQUIREMENTS_HEADING = '## 🧰 Harness-owned checks'

export interface ValidationCheck {
  id: string
  passed: boolean
  message: string
}

export interface ValidationResultArtifact {
  schema_version: 1
  run_id: string
  invocation_id: string
  kind: 'invocation' | 'delegation' | 'attestation'
  status: 'pass' | 'fail'
  summary: string
  checks: ValidationCheck[]
  validated_at: string
  artifact_path: string
}

export type ValidationArtifactLoad =
  | ValidationResultArtifact
  | { state: 'missing' }
  | { state: 'malformed'; reason: string }

export interface InvocationValidationStatus {
  invocation: ValidationArtifactLoad
  delegation: ValidationArtifactLoad
  invocation_validation_path: string
  delegation_validation_path: string
  delegation_path: string
}

export function normalizeMarkdownContent(content: string): string {
  return content.replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

export function normalizeDelegationContent(content: string): string {
  const normalized = normalizeMarkdownContent(content)
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .trimEnd()

  return `${normalized}\n`
}

/**
 * Layout v2 collects per-invocation validation artifacts under the run's
 * `validations/` directory. A layout-v1 run keeps them beside the invocation,
 * because its earlier stages already wrote them there.
 */
function invocationValidationArtifactPath(
  runId: string,
  invocationId: string,
  extension: string,
  root?: string,
): string {
  if (!root) {
    return `runtime/logs/workflows/${runId}/invocations/${invocationId}${extension}`
  }

  const layout = resolveRunLayout(root, runId)

  return layout.version === 'v2'
    ? layout.validation(`${invocationId}${extension}`).relative
    : layout.invocation(invocationId, extension).relative
}

export function invocationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.invocation-validation.json',
    root,
  )
}

export function delegationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.delegation.md')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation.md`
}

/** Sibling path holding the exact prompt body a referenced delivery uses. */
export function deliveryPromptPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.delivery.md')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delivery.md`
}

const MISPLACED_DELEGATION_RELATIVE_PATH = '.delegation.md'

/** Relocate a workspace-root delegation artifact to the invocation-scoped path. */
export function relocateMisplacedDelegationArtifact(
  root: string,
  runId: string,
  invocationId: string,
): boolean {
  const misplacedAbsolute = resolveInside(
    root,
    MISPLACED_DELEGATION_RELATIVE_PATH,
  )

  if (!fileExists(misplacedAbsolute)) {
    return false
  }

  const targetRelative = delegationPath(runId, invocationId, root)
  const targetAbsolute = resolveInside(root, targetRelative)

  ensureDir(path.dirname(targetAbsolute))

  if (!fileExists(targetAbsolute)) {
    writeTextAtomic(targetAbsolute, readText(misplacedAbsolute))
  }

  rmSync(misplacedAbsolute, { force: true })

  return true
}

export function delegationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.delegation-validation.json',
    root,
  )
}

/**
 * Harness-authored execution audit for an external-executor delegation:
 * executor identity, argument vector, exit status, and session.
 */
export function delegationExecutionPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(
        invocationId,
        '.delegation-execution.json',
      ).relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.delegation-execution.json`
}

/** Executor session recorded beside the invocation artifacts for later resume. */
export function sessionRecordPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return root
    ? resolveRunLayout(root, runId).invocation(invocationId, '.session.json')
        .relative
    : `runtime/logs/workflows/${runId}/invocations/${invocationId}.session.json`
}

export function loadDelegationExecutionRecord(
  root: string,
  runId: string,
  invocationId: string,
): ExternalDelegationRecord | null {
  const absolute = resolveInside(
    root,
    delegationExecutionPath(runId, invocationId, root),
  )

  if (!fileExists(absolute)) {
    return null
  }

  const value = readJson(absolute)

  return isRecord(value) && value.schema_version === 1
    ? (value as unknown as ExternalDelegationRecord)
    : null
}

/**
 * Which body the delegation artifact must reproduce, and the matching delivery
 * mode label.
 *
 * A cursor `referenced` delegation owes the compact delivery prompt; a cursor
 * `verbatim` one owes the whole card. An external delegation owes the card for
 * a fresh delivery, but a `resumed` revision round delivers a compact directive
 * that references the card — the harness persists that directive at the
 * delivery-prompt path, so the comparison follows the execution record.
 */
export function expectedDelegationSource(
  root: string,
  invocation: Invocation,
): { path: string; mode: InvocationDeliveryMode } {
  const runId = invocation.run_id
  const invocationId = invocation.invocation_id
  const delegation = invocation.delegation
  const canonicalPath =
    delegation?.canonical_markdown_path ??
    resolveRunLayout(root, runId).invocation(invocationId, '.md').relative

  if (delegation?.mode === 'referenced' && delegation.delivery_prompt_path) {
    return { path: delegation.delivery_prompt_path, mode: 'referenced' }
  }

  const personaExecutor = invocation.stage.persona_executor ?? 'cursor'

  if (personaExecutor !== 'cursor') {
    const record = loadDelegationExecutionRecord(root, runId, invocationId)

    if (record?.delegation_kind === 'resumed') {
      return {
        path: deliveryPromptPath(runId, invocationId, root),
        mode: 'referenced',
      }
    }
  }

  return { path: canonicalPath, mode: 'verbatim' }
}

export function attestationValidationPath(
  runId: string,
  invocationId: string,
  root?: string,
): string {
  return invocationValidationArtifactPath(
    runId,
    invocationId,
    '.attestation-validation.json',
    root,
  )
}

export function buildValidationArtifact(options: {
  run_id: string
  invocation_id: string
  kind: 'invocation' | 'delegation' | 'attestation'
  status: 'pass' | 'fail'
  checks: ValidationCheck[]
  artifact_path: string
  validated_at?: string
}): ValidationResultArtifact {
  const failed = options.checks.filter((check) => !check.passed)
  const summary =
    options.status === 'pass'
      ? `All ${options.checks.length} validation check(s) passed.`
      : `${failed.length} check(s) failed: ${failed.map((check) => check.id).join(', ')}`

  return {
    schema_version: 1,
    run_id: options.run_id,
    invocation_id: options.invocation_id,
    kind: options.kind,
    status: options.status,
    summary,
    checks: options.checks,
    validated_at: options.validated_at ?? new Date().toISOString(),
    artifact_path: options.artifact_path,
  }
}
