import { renameSync, rmSync } from 'node:fs'

import { renderBrief, writeOperatorBriefSource } from './briefs.js'
import { invariant, PanError } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  withOperationMutex,
  writeJsonAtomic,
} from './io.js'
import {
  generatedOperatorBrief,
  operatorArtifactProfileForStage,
} from './operator-artifact-profiles.js'
import { resolveRequirements } from './requirements/resolve.js'
import { runRequirement } from './requirements/run.js'
import { loadRegistry } from './requirements/registry.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState, operationMutexPath, persist } from './state.js'

import type {
  Invocation,
  RequirementValidationResult,
  RunState,
  StageHistoryItem,
  StageOutput,
  WorkflowDefinition,
} from './types.js'

export interface GenerateOperatorArtifactsOptions {
  runId: string
  stage?: string | null
  force?: boolean
}

export interface GeneratedOperatorArtifact {
  stage: string
  invocation_id: string
  status: 'generated' | 'skipped'
  html_path: string
  source_path?: string
  html_sha256?: string
  source_sha256?: string
  validation_paths?: string[]
}

export interface GenerateOperatorArtifactsResult {
  run_id: string
  artifacts: GeneratedOperatorArtifact[]
}

function readWorkflow(root: string, state: RunState): WorkflowDefinition {
  const value = readJson(resolveInside(root, state.workflow_snapshot.path))

  invariant(
    isRecord(value) && Array.isArray(value.stages),
    `Workflow snapshot is invalid: ${state.workflow_snapshot.path}`,
    { code: 'INVALID_WORKFLOW_SNAPSHOT' },
  )

  return value as unknown as WorkflowDefinition
}

function readInvocation(root: string, relativePath: string): Invocation {
  const value = readJson(resolveInside(root, relativePath))

  invariant(
    isRecord(value) &&
      typeof value.invocation_id === 'string' &&
      isRecord(value.stage) &&
      isRecord(value.workflow),
    `Invocation record is invalid: ${relativePath}`,
    { code: 'INVALID_INVOCATION' },
  )

  return value as unknown as Invocation
}

function readStageOutput(root: string, history: StageHistoryItem): StageOutput {
  const value = readJson(resolveInside(root, history.output_path))

  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      value.invocation_id === history.invocation_id &&
      typeof value.summary === 'string' &&
      isRecord(value.data),
    `Submitted stage output is invalid: ${history.output_path}`,
    { code: 'INVALID_STAGE_OUTPUT' },
  )

  return value as unknown as StageOutput
}

function latestSubmittedStages(
  state: RunState,
  stageSlug: string | null,
): StageHistoryItem[] {
  if (stageSlug) {
    const latest = [...state.stage_history]
      .reverse()
      .find((item) => item.stage === stageSlug)

    invariant(latest, `Stage '${stageSlug}' has no submitted attempt.`, {
      code: 'OPERATOR_ARTIFACT_STAGE_UNSUBMITTED',
    })

    return [latest]
  }

  const latest = new Map<string, StageHistoryItem>()

  for (const history of state.stage_history) {
    latest.set(history.stage, history)
  }

  return [...latest.values()]
}

function writeValidationEvidence(
  root: string,
  runId: string,
  invocationId: string,
  result: RequirementValidationResult,
): string {
  const safeId = `${result.policy_id}-${result.requirement_id}`.replaceAll(
    /[^a-zA-Z0-9_.-]/gu,
    '-',
  )
  const relative = resolveRunLayout(root, runId).validation(
    `${invocationId}.generated-${safeId}.json`,
  ).relative

  writeJsonAtomic(resolveInside(root, relative), result)

  return relative
}

function validateGeneratedBrief(
  root: string,
  state: RunState,
  invocation: Invocation,
  targetPath: string,
): { paths: string[]; blocking: RequirementValidationResult[] } {
  const requirements = resolveRequirements(root, {
    persona: invocation.stage.persona,
    workflow: invocation.workflow.slug,
    stage: invocation.stage.slug,
    contracts: state.operator_involvement?.contracts ?? [],
    review_mode: state.review_mode,
    operator_artifacts: 'requested',
    invocation: {
      output_path: invocation.output.path,
      artifact_paths: [targetPath],
    },
  }).validation_requirements.filter(
    (requirement) =>
      requirement.registry_id === 'OPERATOR-ARTIFACT-VALIDATE-001' ||
      requirement.registry_id === 'SIMPLIFIED-ENGLISH-VALIDATE-001',
  )
  const catalog = loadRegistry(root)
  const paths: string[] = []
  const blocking: RequirementValidationResult[] = []

  for (const requirement of requirements) {
    const result = runRequirement({
      root,
      runId: state.run_id,
      requirement,
      targetPath,
      executor: 'harness',
      invocation: invocation as unknown as Record<string, unknown>,
      runState: state as unknown as Record<string, unknown>,
      catalog,
      persist: false,
    })

    paths.push(
      writeValidationEvidence(
        root,
        state.run_id,
        invocation.invocation_id,
        result,
      ),
    )

    if (result.status !== 'passed' && requirement.enforcement !== 'advisory') {
      blocking.push(result)
    }
  }

  return { paths, blocking }
}

function generateOne(
  root: string,
  state: RunState,
  history: StageHistoryItem,
  force: boolean,
): GeneratedOperatorArtifact {
  const layout = resolveRunLayout(root, state.run_id)
  const htmlPath = layout.operatorHtml(history.invocation_id).relative
  const sourcePath = layout.artifactJson(
    `${history.invocation_id}.brief.json`,
  ).relative
  const htmlAbsolute = resolveInside(root, htmlPath)

  if (fileExists(htmlAbsolute) && !force) {
    return {
      stage: history.stage,
      invocation_id: history.invocation_id,
      status: 'skipped',
      html_path: htmlPath,
    }
  }

  const invocationPath = layout.invocation(
    history.invocation_id,
    '.json',
  ).relative
  const invocation = readInvocation(root, invocationPath)
  const output = readStageOutput(root, history)
  const profile = operatorArtifactProfileForStage(
    history.stage,
    state.workflow_slug,
  )
  const brief = generatedOperatorBrief({
    profile,
    title: `${invocation.stage.title} brief`,
    source: `${state.run_id}/${history.invocation_id}`,
    stageTitle: invocation.stage.title,
    outcome: history.outcome,
    summary: output.summary,
    data: output.data,
    risks: output.risks ?? [],
    unknowns: output.unknowns ?? [],
  })

  writeOperatorBriefSource(root, sourcePath, brief)

  const temporaryHtmlPath = layout.artifactJson(
    `${history.invocation_id}.generated.tmp.html`,
  ).relative

  try {
    renderBrief(root, sourcePath, temporaryHtmlPath)

    const validation = validateGeneratedBrief(
      root,
      state,
      invocation,
      temporaryHtmlPath,
    )

    if (validation.blocking.length > 0) {
      throw new PanError(
        `Generated brief validation failed for stage '${history.stage}'.`,
        {
          code: 'GENERATED_BRIEF_VALIDATION_FAILED',
          details: {
            stage: history.stage,
            validation_paths: validation.paths,
          },
        },
      )
    }

    const sourceSha256 = sha256(readText(resolveInside(root, sourcePath)))

    renameSync(resolveInside(root, temporaryHtmlPath), htmlAbsolute)

    const htmlSha256 = sha256(readText(htmlAbsolute))

    rmSync(resolveInside(root, sourcePath), { force: true })

    return {
      stage: history.stage,
      invocation_id: history.invocation_id,
      status: 'generated',
      html_path: htmlPath,
      source_path: sourcePath,
      html_sha256: htmlSha256,
      source_sha256: sourceSha256,
      validation_paths: validation.paths,
    }
  } catch (error) {
    rmSync(resolveInside(root, temporaryHtmlPath), {
      force: true,
      recursive: true,
    })
    throw error
  }
}

/** Generate validated briefs from the latest submitted stage records. */
export function generateOperatorArtifacts(
  root: string,
  options: GenerateOperatorArtifactsOptions,
): GenerateOperatorArtifactsResult {
  return withOperationMutex(operationMutexPath(root, options.runId), () => {
    const state = loadState(root, options.runId)
    const workflow = readWorkflow(root, state)
    const stageSlug = options.stage ?? null

    if (stageSlug) {
      invariant(
        workflow.stages.some((stage) => stage.slug === stageSlug),
        `Unknown stage '${stageSlug}' in workflow '${workflow.slug}'.`,
        { code: 'OPERATOR_ARTIFACT_STAGE_UNKNOWN' },
      )
    }

    const historyItems = latestSubmittedStages(state, stageSlug)
    const artifacts: GeneratedOperatorArtifact[] = []

    for (const history of historyItems) {
      const artifact = generateOne(root, state, history, options.force ?? false)

      artifacts.push(artifact)

      if (artifact.status === 'generated') {
        persist(root, state, 'operator_artifacts_generated', {
          artifacts: [
            {
              stage: artifact.stage,
              invocation_id: artifact.invocation_id,
              path: artifact.html_path,
              html_sha256: artifact.html_sha256,
              source_sha256: artifact.source_sha256,
              validation_paths: artifact.validation_paths,
            },
          ],
        })
      }
    }

    return { run_id: state.run_id, artifacts }
  })
}
