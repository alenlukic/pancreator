/**
 * Operator workspace directives: attributing workspace changes to the operator.
 */

import { randomUUID } from 'node:crypto'

import { invariant } from '../errors.js'
import { resolveInside, withOperationMutex, writeTextAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import { operationMutexPath, loadState, now } from '../state.js'
import type {
  RunState,
  WorkspaceAttributionDisposition,
  WorkspaceDirectiveRecord,
} from '../types.js'
import { gitStatusPaths, isGitRepository } from '../git.js'
import { isProtectedWorkspacePath } from '../workspace/protected-paths.js'
import {
  DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION,
  recordWorkspaceAttribution,
} from '../workspace-attribution.js'

import {
  persistRun,
  workspaceDirectory,
  workspaceSnapshotForRun,
} from './core.js'

/**
 * The newest workspace fingerprint some record in this run is accountable for.
 *
 * A stage attempt closes its window at its own after-fingerprint, and an
 * out-of-stage attribution record closes its window the same way. Whichever
 * closed last opens the next window, so consecutive records bound the
 * workspace without a gap.
 */
function lastAccountableFingerprint(state: RunState): string | undefined {
  const stage = state.stage_history.at(-1)
  const directive = state.workspace_directives?.at(-1)

  if (!directive) {
    return stage?.workspace_fingerprint
  }

  if (!stage) {
    return directive.workspace_fingerprint
  }

  return Date.parse(directive.timestamp) >= Date.parse(stage.submitted_at)
    ? directive.workspace_fingerprint
    : stage.workspace_fingerprint
}

/**
 * Record an operator directive executed against the workspace outside a
 * stage, so the next worker attributes the delta by reading rather than by
 * audit.
 *
 * The supervisor executes such a directive as the operator's mechanical
 * delegate, between stages, with no invocation of its own. Nothing else in
 * the run claims the resulting change.
 */
export function recordWorkspaceDirective(
  root: string,
  runId: string,
  options: {
    directive: string
    actingRole?: WorkspaceDirectiveRecord['acting_role']
    disposition?: WorkspaceAttributionDisposition
    paths?: string[]
  },
): WorkspaceDirectiveRecord {
  return withOperationMutex(operationMutexPath(root, runId), () => {
    const state = loadState(root, runId)
    const directive = options.directive.trim()

    invariant(directive.length > 0, 'A directive text is required.', {
      code: 'INVALID_ARGUMENT',
    })

    const workspace = workspaceSnapshotForRun(root, state)
    const workspacePath = workspaceDirectory(root, state)
    const declared = (options.paths ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    const changedPaths = [
      ...new Set(
        declared.length > 0
          ? declared
          : gitStatusPaths(workspacePath).filter(
              (relativePath) =>
                !relativePath.startsWith('runtime/') &&
                !isProtectedWorkspacePath(relativePath),
            ),
      ),
    ].sort()

    invariant(
      changedPaths.length > 0,
      'The workspace holds no tracked change to attribute. Name the paths ' +
        'with --paths when the change is already committed.',
      { code: 'INVALID_RUN_ACTION' },
    )

    const records = state.workspace_directives ?? []
    const relativePath = resolveRunLayout(root, runId).evidence(
      `workspace-directive-${records.length + 1}.md`,
    ).relative

    const actingRole = options.actingRole ?? 'supervisor'
    const disposition =
      options.disposition ?? DEFAULT_WORKSPACE_ATTRIBUTION_DISPOSITION

    const timestamp = now()
    const beforeFingerprint = lastAccountableFingerprint(state)

    const record: WorkspaceDirectiveRecord = {
      directive_id: `directive-${randomUUID()}`,
      acting_role: actingRole,
      directive,
      stage: state.current_stage ?? 'none',
      disposition,
      changed_paths: changedPaths,
      ...(beforeFingerprint
        ? { workspace_before_fingerprint: beforeFingerprint }
        : {}),
      workspace_fingerprint: workspace.fingerprint,
      artifact_path: relativePath,
      timestamp,
    }

    writeTextAtomic(
      resolveInside(root, relativePath),
      [
        '# Operator-directed workspace change',
        '',
        `**Run** \`${runId}\` · **Stage** \`${record.stage}\``,
        `**Acting role:** ${actingRole}`,
        `**Disposition:** ${disposition}`,
        `**Recorded at:** ${timestamp}`,
        `**Workspace fingerprint:** \`${beforeFingerprint ?? 'unrecorded'}\` → \`${workspace.fingerprint}\``,
        '',
        '## Directive',
        '',
        directive,
        '',
        '## Changed paths',
        '',
        ...changedPaths.map((item) => `- \`${item}\``),
        '',
      ].join('\n') + '\n',
    )

    // One command writes both records: the run-scoped directive that answers
    // who changed the workspace, and the repository-scoped attribution every
    // clean-tree gate reads. A workspace Git does not track has no repository
    // to key the second record on, and no clean-tree gate can refuse it, so
    // the directive record is written alone rather than lost to a Git error.
    if (isGitRepository(workspacePath)) {
      recordWorkspaceAttribution(root, {
        workspacePath,
        runId,
        actingRole,
        directive,
        disposition,
        paths: changedPaths,
        artifactPath: relativePath,
      })
    }

    records.push(record)
    state.workspace_directives = records
    persistRun(root, state, 'workspace_directive_recorded', {
      directive_id: record.directive_id,
      acting_role: actingRole,
      stage: record.stage,
      disposition,
      changed_paths: changedPaths,
      artifact_path: relativePath,
    })

    return record
  })
}
