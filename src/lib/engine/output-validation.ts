/**
 * Pre-submission output validation: `pan output validate` mirrors the
 * validators `pan submit` runs before its shell gates, against a draft output,
 * without changing run state.
 */

import { rmSync } from 'node:fs'
import path from 'node:path'

import {
  fileExists,
  isRecord,
  readText,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import { isPassingResult, runRequirement } from '../requirements/run.js'
import { loadRegistry } from '../requirements/registry.js'
import { evidenceWorkerAttempts } from '../render.js'
import { loadState } from '../state.js'
import type { Invocation } from '../types.js'
import {
  validateInvocationAttestation,
  validateStageOutput,
  type ValidationCheck,
} from '../validation.js'
import { stageBySlug } from '../workflow.js'

import { loadRunWorkflow } from './core.js'
import { resolveSubmitValidators } from './submit-validators.js'
import { materializeOutputSubmission } from './submit-helpers.js'

/** Command that owns one output-validate scratch copy. */
export type OutputValidateCaller = 'output-validate' | 'submission-mirror'

/**
 * Scratch copy an output-targeted validator reads when the bytes under
 * validation are not at the declared output path.
 *
 * Validator handlers resolve a relative target against the harness root, so
 * the value needs a real file at a resolvable path. Each caller owns its own
 * subdirectory: two commands against one run would otherwise derive the same
 * name and then remove the directory the other one is still reading.
 */
export function outputValidateScratchPath(
  runId: string,
  outputBasename: string,
  caller: OutputValidateCaller,
): string {
  return path.posix.join(
    'runtime',
    'cache',
    'output-validate',
    runId,
    caller,
    path.basename(outputBasename),
  )
}

/**
 * Mirror every validator `pan submit` runs before its shell gates, so a
 * mechanical defect does not consume a stage attempt. Only the shell gates
 * stay submit-only; the harness-authoritative validators run here from the
 * same resolved set `resolveSubmitValidators` gives the submission, without
 * persisting a validation record.
 */
export function validateOutputForSubmission(
  root: string,
  runId: string,
  invocation: Invocation,
  submittedValue: unknown,
  options: {
    /** Harness-relative path of the file under validation, when it exists. */
    submittedPath?: string
  } = {},
): { passed: boolean; checks: ValidationCheck[] } {
  const checks: ValidationCheck[] = []
  const state = loadState(root, runId)
  const materialized = materializeOutputSubmission(
    root,
    state,
    submittedValue,
    invocation.invocation_id,
  )
  const effectiveValue = materialized.value

  for (const worker of invocation.evidence_workers ?? []) {
    const attempts = evidenceWorkerAttempts(worker)
    const written = attempts.filter((attempt) => {
      try {
        const absolute = resolveInside(root, attempt.evidence_path)

        return fileExists(absolute) && readText(absolute).trim().length > 0
      } catch {
        return false
      }
    })
    const declared = attempts.map((attempt) => attempt.evidence_path).join(', ')

    checks.push({
      id: `evidence.${worker.role}`,
      passed: written.length > 0,
      message:
        written.length > 0
          ? `Evidence report for role '${worker.role}' is present at ` +
            written.map((attempt) => attempt.evidence_path).join(', ')
          : `Evidence report for role '${worker.role}' is missing or empty at ${declared}`,
    })
  }

  if (invocation.contract_manifest) {
    checks.push(
      ...validateInvocationAttestation(invocation, effectiveValue, { root })
        .checks,
    )
  }

  const workflow = loadRunWorkflow(root, state)
  const stage = stageBySlug(workflow, invocation.stage.slug)

  // The harness renders the operator brief during submission, so its absence
  // before submit is expected.
  const renderedPath = invocation.output.operator_brief?.rendered_path
  const structural = validateStageOutput(
    root,
    stage,
    invocation,
    effectiveValue,
    { pendingArtifactPaths: renderedPath ? [renderedPath] : [] },
  )
  const structuralErrors = structural.errors

  if (structuralErrors.length === 0) {
    checks.push({
      id: 'output.contract',
      passed: true,
      message: 'Output satisfies the structural stage contract',
    })
  } else {
    checks.push(
      ...structuralErrors.map((message, index) => ({
        id: `output.contract.${index + 1}`,
        passed: false,
        message,
      })),
    )
  }

  const catalog = loadRegistry(root)
  const submittedRecord = isRecord(effectiveValue)
    ? effectiveValue
    : ({} as Record<string, unknown>)

  // Before submit the output may still sit outside its declared path, or
  // only in memory. Output-targeted validators then read the file under
  // validation, or a scratch copy of the value that is removed afterwards, so
  // the mirror judges the same bytes the submission would.
  const declaredOutputExists = fileExists(
    resolveInside(root, invocation.output.path),
  )
  const submittedAbsolute =
    options.submittedPath !== undefined
      ? resolveInside(root, options.submittedPath)
      : null

  let scratchOutput: string | null = null
  const outputTargetPath = (): string => {
    // The operator's file wins. A stale copy at the declared path must not
    // stand in for the bytes the operator asked to validate.
    if (
      materialized.revisedFrom === undefined &&
      options.submittedPath !== undefined &&
      submittedAbsolute &&
      fileExists(submittedAbsolute)
    ) {
      return options.submittedPath
    }

    if (options.submittedPath === undefined && declaredOutputExists) {
      return invocation.output.path
    }

    // Handlers resolve a relative target against the harness root, so the
    // scratch copy lives under runtime/cache and is removed afterwards.
    if (scratchOutput === null) {
      scratchOutput = outputValidateScratchPath(
        runId,
        invocation.output.path,
        'submission-mirror',
      )
      writeJsonAtomic(resolveInside(root, scratchOutput), submittedRecord)
    }

    return scratchOutput
  }

  try {
    const reportedValidators = new Set<string>()

    for (const {
      requirement,
      target_path: targetPath,
    } of resolveSubmitValidators(root, invocation, submittedRecord, catalog)) {
      reportedValidators.add(requirement.registry_id)

      if (renderedPath && targetPath === renderedPath) {
        checks.push({
          id: `validator.${requirement.registry_id}`,
          passed: true,
          message:
            `${requirement.registry_id} deferred to submit: the harness ` +
            `renders ${renderedPath} during submission`,
        })
        continue
      }

      const result = runRequirement({
        root,
        runId,
        requirement,
        targetPath:
          targetPath === invocation.output.path
            ? outputTargetPath()
            : targetPath,
        executor: 'harness',
        workspaceFingerprint: invocation.workspace_before.fingerprint,
        invocation: invocation as unknown as Record<string, unknown>,
        runState: state as unknown as Record<string, unknown>,
        catalog,
        persist: false,
      })
      const passed = isPassingResult(result)

      checks.push({
        id: `validator.${requirement.registry_id}`,
        passed,
        message: passed
          ? `${requirement.registry_id} passed (${requirement.enforcement})`
          : `${requirement.registry_id} ${result.status} (${requirement.enforcement}): ` +
            result.issues.map((issue) => issue.message).join('; '),
      })
    }

    for (const declared of invocation.output.field_contract?.validators ?? []) {
      if (reportedValidators.has(declared.registry_id)) {
        continue
      }

      const passed = declared.enforcement === 'advises'

      checks.push({
        id: `validator.${declared.registry_id}`,
        passed,
        message:
          `${declared.registry_id} could not be resolved from the invocation ` +
          `requirements (${declared.enforcement})`,
      })
    }
  } finally {
    if (scratchOutput !== null) {
      rmSync(path.dirname(resolveInside(root, scratchOutput)), {
        recursive: true,
        force: true,
      })
    }
  }

  return { passed: checks.every((check) => check.passed), checks }
}
