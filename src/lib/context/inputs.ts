/** `buildInvocationInputs`: the assembled inputs of one invocation. */

import { isSelfDevelopmentInstallation } from '../project-config.js'
import type { Invocation, InvocationReference } from '../types.js'
import {
  addReference,
  inspectContextReference,
  type InvocationContextOptions,
} from './references.js'
import { availableReferences, selectStageOutputs } from './stage-outputs.js'
import { selectEntryGateFailureEvidence } from './entry-gate-evidence.js'
import { selectReleaseEvidence } from './release-evidence.js'
import {
  selectExceptions,
  selectOperatorFeedback,
  selectPriorAttempts,
  selectWorkerHandoff,
} from './prior-attempts.js'
import { selectGateEvidence } from './gate-evidence.js'
import { remediationReturn } from './remediation-return.js'
import { targetInstructionInput } from './target-instruction-input.js'
import { writeContextManifest } from './manifest.js'

/** Build a stage-scoped context projection and a discoverable full-history index. */
export function buildInvocationInputs(
  options: InvocationContextOptions,
): Invocation['inputs'] {
  const references = new Map<string, InvocationReference>()
  const missingRequired: string[] = []
  const { state, stage } = options

  if (stage.context.legacy_full_history) {
    return {
      references: availableReferences(state).map((reference) => ({
        path: reference.path,
        description: reference.description,
        retrieval: 'required',
      })),
    }
  }

  if (stage.context.request !== 'omit') {
    addReference(references, {
      path: state.request.stored_path,
      description: 'Original operator request',
      retrieval: stage.context.request,
      ...(stage.context.request === 'conditional'
        ? {
            condition:
              'Read only when the effective stage outputs do not preserve enough operator intent for this task.',
          }
        : {}),
    })
  }

  // The wider context stays a required read for every stage, independent of
  // `context.request`. A stage that reads a child specification without the
  // parent decides cross-unit questions on partial scope.
  const contextReference = state.request.context_reference
  const contextReferenceInspection = contextReference
    ? inspectContextReference(options.root, contextReference)
    : undefined

  if (contextReference && contextReferenceInspection) {
    addReference(references, {
      path: contextReference.source_path,
      description: 'Parent context this work unit reads by reference',
      retrieval: 'required',
    })

    if (contextReferenceInspection.status === 'missing') {
      missingRequired.push(contextReference.source_path)
    }
  }

  selectStageOutputs(
    references,
    missingRequired,
    state,
    stage.context.required_stage_outputs,
    'required',
  )
  selectStageOutputs(
    references,
    missingRequired,
    state,
    stage.context.conditional_stage_outputs,
    'conditional',
  )
  selectReleaseEvidence(references, missingRequired, options.root, state)
  selectEntryGateFailureEvidence(references, missingRequired, options, stage)
  selectPriorAttempts(references, options.root, state, stage, options.attempt)
  selectWorkerHandoff(references, options, stage)
  selectOperatorFeedback(references, state, stage)
  selectExceptions(references, state, stage, options.workspaceFingerprint)
  selectGateEvidence(
    references,
    options.root,
    state,
    stage,
    options.workspaceFingerprint,
  )
  const targetInstructions = targetInstructionInput(options)

  for (const instructionPath of targetInstructions?.read_paths ?? []) {
    addReference(references, {
      path: instructionPath,
      description:
        'Target instruction file resolved from declared changed paths',
      retrieval: 'required',
    })
  }

  if (options.prDescription?.template_path) {
    addReference(references, {
      path: options.prDescription.template_path,
      description: 'Resolved target pull-request template',
      retrieval: 'required',
    })
  }

  for (const instructionPath of options.prDescription?.instruction_paths ??
    []) {
    addReference(references, {
      path: instructionPath,
      description: 'Resolved target pull-request instruction file',
      retrieval: 'required',
    })
  }

  if (stage.persona === 'coder') {
    for (const baseline of Object.values(
      state.repository_check_baselines ?? {},
    )) {
      if (!baseline) {
        continue
      }

      addReference(references, {
        path: baseline.artifact_path,
        description:
          `Required pre-implementation ${baseline.profile} check baseline ` +
          `(${baseline.status})`,
        retrieval: 'required',
      })
    }
  }

  if (
    stage.persona === 'release-steward' &&
    stage.slug === 'ship' &&
    isSelfDevelopmentInstallation(options.root)
  ) {
    addReference(references, {
      path: 'VERSION',
      description: 'Current Pancreator harness version',
      retrieval: 'required',
    })
    addReference(references, {
      path: 'release/index.json',
      description: 'Internal Pancreator release-to-commit index',
      retrieval: 'required',
    })
  }

  const selected = [...references.values()]
  const selectedPaths = new Set(selected.map((reference) => reference.path))
  const omitted = availableReferences(state).filter(
    (reference) => !selectedPaths.has(reference.path),
  )
  const manifestReference = writeContextManifest(
    options,
    selected,
    omitted,
    missingRequired,
  )

  if (manifestReference) {
    addReference(references, manifestReference)
  }

  const returnVisit = remediationReturn(options.root, state, stage)

  return {
    references: [...references.values()],
    ...(missingRequired.length > 0
      ? { missing_required: missingRequired }
      : {}),
    ...(returnVisit ? { remediation_return: returnVisit } : {}),
    ...(targetInstructions ? { target_instructions: targetInstructions } : {}),
    ...(options.prDescription ? { pr_description: options.prDescription } : {}),
    ...(contextReference && contextReferenceInspection
      ? {
          context_reference: {
            ...contextReference,
            reference_status: contextReferenceInspection.status,
            ...(contextReferenceInspection.status === 'drifted' &&
            contextReferenceInspection.actual_content_sha256
              ? {
                  actual_content_sha256:
                    contextReferenceInspection.actual_content_sha256,
                }
              : {}),
          },
        }
      : {}),
  }
}
