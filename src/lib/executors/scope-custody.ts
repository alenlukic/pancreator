import path from 'node:path'

import { isRecord, resolveInside } from '../io.js'
import { PanError } from '../errors.js'
import type { StageDefinition } from '../types.js'
import type {
  DelegationWriteBoundary,
  DelegationWriteObservation,
} from './delegation-live.js'

/** Controller-owned snapshots are excluded from every worker write grant. */
export function custodyAuthorityRoot(root: string): string {
  return resolveInside(root, 'runtime/custody')
}

/** The shared stage authority used by executor enforcement and attribution. */
export function stageWriteRoots(
  root: string,
  workspaceDir: string,
  stage: StageDefinition,
): string[] {
  const runtimeTree = resolveInside(root, 'runtime')
  const sourceWritable =
    stage.workspace_policy === 'source_allowed' ||
    stage.workspace_policy === 'release_metadata_only'

  return sourceWritable
    ? [...new Set([workspaceDir, runtimeTree])]
    : [runtimeTree]
}

export function isDelegationWriteBoundary(
  value: unknown,
): value is DelegationWriteBoundary {
  return (
    isRecord(value) &&
    (value.mode === 'sandbox-exec' || value.mode === 'none') &&
    typeof value.reason === 'string' &&
    (value.mode === 'none' ? value.reason.length > 0 : value.reason === '') &&
    [value.write_roots, value.effective_write_roots].every(
      (roots) =>
        Array.isArray(roots) &&
        roots.every(
          (item) => typeof item === 'string' && path.isAbsolute(item),
        ),
    )
  )
}

/** Resolve existing ancestors too, so an absent leaf cannot hide a symlink escape. */
export function withinWriteRoots(target: string, roots: string[]): boolean {
  if (!path.isAbsolute(target)) {
    return false
  }

  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(target))

    try {
      resolveInside(root, relative || '.')
      return true
    } catch (error) {
      if (
        error instanceof PanError &&
        ['PATH_ESCAPE', 'PATH_NOT_FOUND'].includes(error.code)
      ) {
        return false
      }
      throw error
    }
  })
}

/**
 * Tool events are positive evidence only: an absent event never proves no
 * write occurred. A shell denial with no parsed path still owes adjudication.
 */
export function observeToolWrite(
  text: string,
  pending: Map<string, string[]>,
  cwd: string,
  observe: (observation: Omit<DelegationWriteObservation, 'evidence'>) => void,
): void {
  const event: unknown = JSON.parse(text)
  if (!isRecord(event) || !isRecord(event.data)) {
    return
  }
  const data = event.data
  const id = typeof data.toolCallId === 'string' ? data.toolCallId : ''
  if (event.type === 'tool.execution_start' && isRecord(data.arguments)) {
    const name = data.toolName
    if (['edit', 'create', 'apply_patch', 'bash'].includes(String(name))) {
      pending.set(id, [])
      const target = data.arguments.path ?? data.arguments.file_path
      if (typeof target === 'string') {
        pending.set(id, [path.resolve(cwd, target)])
      }
    }
  }
  if (event.type !== 'tool.execution_complete') {
    return
  }
  const result = JSON.stringify(data.result ?? data.error ?? '')
  const denied =
    data.success === false &&
    /EPERM|EACCES|operation not permitted|permission denied|outside.*(?:root|scope)|PATH_ESCAPE/iu.test(
      result,
    )
  const targets = pending.get(id)
  for (const target of targets?.length
    ? targets
    : denied && targets
      ? ['<unresolved denied write>']
      : []) {
    if (denied || data.success === true) {
      observe({ path: target, outcome: denied ? 'denied' : 'written' })
    }
  }
  pending.delete(id)
}
