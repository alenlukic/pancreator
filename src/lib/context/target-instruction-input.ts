/** Output changed paths and the target-instruction input of an invocation. */

import path from 'node:path'

import { snapshotEntryPath } from '../git.js'
import { readJson, resolveInside, isRecord } from '../io.js'
import { resolveTargetInstructionPaths } from '../target-instructions.js'
import type { RunState, TargetInstructionInput } from '../types.js'
import type { InvocationContextOptions } from './references.js'

export function outputChangedPaths(
  root: string,
  state: RunState,
  stageSlug: string,
): string[] {
  const outputPath = [...state.stage_history]
    .reverse()
    .find(
      (item) => item.stage === stageSlug && item.outcome === 'success',
    )?.output_path

  if (!outputPath) {
    return []
  }

  const value = readJson(resolveInside(root, outputPath))
  const data = isRecord(value) && isRecord(value.data) ? value.data : null

  if (!data) {
    return []
  }

  if (stageSlug === 'plan') {
    const plan = isRecord(data.engineering_plan) ? data.engineering_plan : null
    const files = plan && Array.isArray(plan.files) ? plan.files : []

    return files.flatMap((item) =>
      isRecord(item) && typeof item.path === 'string' ? [item.path] : [],
    )
  }

  const implementation = isRecord(data.implementation)
    ? data.implementation
    : null
  const files =
    implementation && Array.isArray(implementation.changed_files)
      ? implementation.changed_files
      : []

  return files.filter((item): item is string => typeof item === 'string')
}

export function targetInstructionInput(
  options: InvocationContextOptions,
): TargetInstructionInput | undefined {
  const { root, state, stage, workspace } = options

  const editingStages = ['implement', 'consolidate', 'remediate']

  if (![...editingStages, 'review', 'test', 'verify'].includes(stage.slug)) {
    return undefined
  }

  const sourceStage =
    state.workflow_slug === 'metacritic' ? 'consolidate' : 'implement'
  // An editing stage reads the paths the plan declared, when the run holds a
  // plan stage, and the paths an earlier implement attempt already changed.
  // A delivery run starts at implement and holds no plan output, so its
  // remediate stage learns its scope from the implement output alone.
  const declared = editingStages.includes(stage.slug)
    ? [
        ...outputChangedPaths(root, state, 'plan'),
        ...outputChangedPaths(root, state, sourceStage),
      ]
    : outputChangedPaths(root, state, sourceStage)
  const current = editingStages.includes(stage.slug)
    ? []
    : (workspace?.entries ?? []).map((entry) => snapshotEntryPath(entry))
  const changedPaths = [...new Set([...declared, ...current])].sort()

  const workspaceRoot = path.resolve(root, state.workspace_root || '.')
  const readPaths = resolveTargetInstructionPaths(workspaceRoot, changedPaths)

  return { changed_paths: changedPaths, read_paths: readPaths }
}
