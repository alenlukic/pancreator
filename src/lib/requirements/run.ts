import path from 'node:path'

import {
  fileExists,
  isRecord,
  readText,
  sha256,
  writeJsonAtomic,
} from '../io.js'
import type {
  RequirementValidationResult,
  ResolvedRequirement,
} from '../types.js'
import { getHandler } from './handlers.js'
import { loadRegistry } from './registry.js'
import { isValidHandlerStatus } from './types.js'

export interface RunRequirementOptions {
  root: string
  runId?: string
  requirement: ResolvedRequirement
  targetPath: string
  executor: 'agent' | 'harness'
  workspaceFingerprint?: string
  invocation?: Record<string, unknown>
  runState?: Record<string, unknown>
  catalog?: ReturnType<typeof loadRegistry>
  persist?: boolean
}

/** Resolve the on-disk path for a policy-bound requirement target. */
export function resolveRequirementTargetPath(
  requirement: ResolvedRequirement,
  fallbackPath: string,
  context?: Record<string, unknown>,
): string | null {
  if (requirement.resolved_target) {
    return requirement.resolved_target
  }

  if (requirement.target === 'invocation.output.path') {
    const output = isRecord(context?.output) ? context.output : null

    return output && typeof output.path === 'string'
      ? output.path
      : fallbackPath
  }

  if (requirement.target.startsWith('artifact:')) {
    const index = Number.parseInt(
      requirement.target.slice('artifact:'.length),
      10,
    )
    const submittedArtifacts = Array.isArray(context?.artifacts)
      ? context.artifacts
      : []
    const invocationArtifacts = Array.isArray(context?.invocation_artifacts)
      ? context.invocation_artifacts
      : []
    const artifact = submittedArtifacts[index] ?? invocationArtifacts[index]

    if (isRecord(artifact) && typeof artifact.path === 'string') {
      return artifact.path
    }

    return null
  }

  if (requirement.target === 'repository' || requirement.target === '.') {
    return '.'
  }

  return fallbackPath
}

export function inferTargetKind(targetPath: string): string {
  if (targetPath === '.' || targetPath === 'repository') {
    return 'repository'
  }

  if (targetPath.includes('/outputs/') && targetPath.endsWith('.json')) {
    return 'stage-output-json'
  }

  if (targetPath.includes('/assessments/') && targetPath.endsWith('.json')) {
    return 'assessment-json'
  }

  if (targetPath.includes('.delegation.md')) {
    return 'delegation-markdown'
  }

  if (targetPath.includes('/invocations/') && targetPath.endsWith('.md')) {
    return 'invocation-markdown'
  }

  if (targetPath.endsWith('.md')) {
    return 'markdown-artifact'
  }

  return 'unknown'
}

export function registryStageSlug(registryId: string): string | null {
  const mapping: Record<string, string> = {
    'INTAKE-VALIDATE-001': 'intake',
    'PLAN-TRACE-VALIDATE-001': 'plan',
    'IMPLEMENTATION-CLAIMS-VALIDATE-001': 'implement',
    'REVIEW-VALIDATE-001': 'review',
    'QA-VALIDATE-001': 'test',
    'RELEASE-VALIDATE-001': 'ship',
    'DECOMPOSITION-VALIDATE-001': 'decompose',
    'INVESTIGATION-VALIDATE-001': 'investigate',
    'SPOTFIX-VALIDATE-001': 'spotfix',
  }

  return mapping[registryId] ?? null
}

function validationResultPath(
  runId: string,
  policyId: string,
  requirementId: string,
  executor: string,
): string {
  const safe = `${policyId}-${requirementId}-${executor}`.replaceAll(
    /[^a-zA-Z0-9_.-]/gu,
    '-',
  )

  return `runtime/logs/workflows/${runId}/validations/${safe}.json`
}

/** Run one policy-bound requirement against an exact target. */
export function runRequirement(
  options: RunRequirementOptions,
): RequirementValidationResult {
  const startedAt = new Date().toISOString()
  const absoluteTarget = path.isAbsolute(options.targetPath)
    ? options.targetPath
    : path.join(options.root, options.targetPath)
  const catalog = options.catalog ?? loadRegistry(options.root)
  const entry = catalog.entries.get(options.requirement.registry_id)
  const handler = entry ? getHandler(entry.handler) : undefined
  const command = `pan requirements run --registry ${options.requirement.registry_id} --target ${options.targetPath}`

  if (!entry) {
    return buildResult(options, startedAt, command, {
      status: 'invalid',
      exit_code: 1,
      issues: [
        {
          code: 'registry.missing',
          message: `Unknown registry id ${options.requirement.registry_id}`,
        },
      ],
    })
  }

  if (!handler) {
    return buildResult(options, startedAt, command, {
      status: 'invalid',
      exit_code: 1,
      handler: entry.handler,
      registry_version: entry.version,
      issues: [
        {
          code: 'handler.missing',
          message: `No handler registered for ${entry.handler}`,
        },
      ],
    })
  }

  if (!fileExists(absoluteTarget) && options.targetPath !== '.') {
    return buildResult(options, startedAt, command, {
      status: 'failed',
      exit_code: 1,
      handler: entry.handler,
      registry_version: entry.version,
      issues: [
        {
          code: 'target.missing',
          message: `Target does not exist: ${options.targetPath}`,
        },
      ],
    })
  }

  const targetChecksum = fileExists(absoluteTarget)
    ? sha256(readText(absoluteTarget))
    : undefined

  const handlerResult = handler({
    root: options.root,
    targetPath: options.targetPath,
    requirement: {
      policy_id: options.requirement.policy_id,
      requirement_id: options.requirement.requirement_id,
      registry_id: options.requirement.registry_id,
      arguments: options.requirement.arguments,
    },
    catalog,
    invocation: options.invocation,
    runState: options.runState,
  })

  if (!isValidHandlerStatus(handlerResult.status)) {
    return buildResult(options, startedAt, command, {
      status: 'invalid',
      exit_code: 1,
      handler: entry.handler,
      registry_version: entry.version,
      target_checksum: targetChecksum,
      issues: [
        {
          code: 'handler.malformed',
          message: `Handler returned invalid status: ${String(handlerResult.status)}`,
        },
      ],
    })
  }

  if (fileExists(absoluteTarget) && options.targetPath !== '.') {
    const afterChecksum = sha256(readText(absoluteTarget))

    if (targetChecksum && afterChecksum !== targetChecksum) {
      return buildResult(options, startedAt, command, {
        status: 'failed',
        exit_code: 1,
        handler: entry.handler,
        registry_version: entry.version,
        target_checksum: targetChecksum,
        issues: [
          {
            code: 'target.stale',
            message: `Target changed during validation: ${options.targetPath}`,
          },
        ],
      })
    }
  }

  const result = buildResult(options, startedAt, command, {
    status: handlerResult.status,
    exit_code: handlerResult.status === 'passed' ? 0 : 1,
    handler: entry.handler,
    registry_version: entry.version,
    target_checksum: targetChecksum,
    issues: handlerResult.issues.slice(0, 50),
    evidence_paths: handlerResult.evidence_paths ?? [],
  })

  if (options.persist !== false && options.runId) {
    const evidencePath = validationResultPath(
      options.runId,
      options.requirement.policy_id,
      options.requirement.requirement_id,
      options.executor,
    )

    writeJsonAtomic(path.join(options.root, evidencePath), result)
    result.evidence_paths = [evidencePath, ...result.evidence_paths]
  }

  return result
}

function buildResult(
  options: RunRequirementOptions,
  startedAt: string,
  command: string,
  fields: {
    status: RequirementValidationResult['status']
    exit_code: number
    handler?: string
    registry_version?: string
    target_checksum?: string
    issues: RequirementValidationResult['issues']
    evidence_paths?: string[]
  },
): RequirementValidationResult {
  return {
    schema_version: 1,
    requirement_id: options.requirement.requirement_id,
    policy_id: options.requirement.policy_id,
    registry_id: options.requirement.registry_id,
    registry_version: fields.registry_version ?? '0',
    handler: fields.handler ?? 'unknown',
    command,
    target_path: options.targetPath,
    ...(fields.target_checksum
      ? { target_checksum: fields.target_checksum }
      : {}),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    exit_code: fields.exit_code,
    status: fields.status,
    executor: options.executor,
    issues: fields.issues,
    evidence_paths: fields.evidence_paths ?? [],
    ...(options.workspaceFingerprint
      ? { workspace_fingerprint: options.workspaceFingerprint }
      : {}),
  }
}

export function isStaleTarget(
  beforeChecksum: string | undefined,
  afterChecksum: string,
): boolean {
  return Boolean(beforeChecksum && beforeChecksum !== afterChecksum)
}

export function isPassingResult(result: RequirementValidationResult): boolean {
  return result.status === 'passed' && result.exit_code === 0
}
