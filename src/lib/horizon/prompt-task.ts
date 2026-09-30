/**
 * Prompt tasks: the request file, the scope snapshot and changed-path check,
 * the workspace, and the headless agent session that executes the task.
 */

import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'

import { buildGovernanceCard } from '../governance-card.js'
import {
  writeTextAtomic,
  resolveInside,
  ensureDir,
  writeJsonAtomic,
} from '../io.js'
import {
  loadPipelineConfig,
  resolvePersonaMapping,
} from '../pipeline-config.js'
import { runCursorAgentSession } from '../executors/cursor-agent.js'
import { resolveOrCreateWorktree } from '../worktrees.js'
import { isProtectedWorkspacePath } from '../workspace/protected-paths.js'
import { resolveWriteSandbox } from '../executors/write-sandbox.js'
import {
  HORIZON_ROOT,
  fail,
  now,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'

function writePromptRequest(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
): string {
  const relative = path.posix.join(
    'runtime',
    'inbox',
    'queue',
    `horizon-${state.session_id}-${task.id}.md`,
  )
  writeTextAtomic(
    resolveInside(root, relative),
    `${task.prompt?.trim() ?? ''}\n`,
  )
  return relative
}

function pathInside(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate)

  return (
    relative.length === 0 ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..')
  )
}

/**
 * Classes the fallback observation skips, named in its own evidence.
 *
 * A Git internal directory records the repository's own bookkeeping rather
 * than a file the task authored, and a protected class is outside agent
 * remit by policy. Neither is a tree the check can quietly drop: a reader
 * of the result sees exactly what was and was not looked at.
 */
const PROMPT_TASK_SKIPPED_CLASSES = ['.git', 'protected-paths'] as const

/**
 * Fingerprint every path a prompt task could change outside its granted
 * roots, for the hosts where the write boundary cannot be enforced.
 *
 * This walk is the fallback, not the primary control. It observes the whole
 * harness root with no tree excluded, because an excluded tree is a change
 * that can happen while the result reports a clean pass. That completeness
 * costs a full stat of the root and cannot tell this agent's write from a
 * concurrent run's, which is why an enforced boundary is preferred wherever
 * the platform offers one.
 */
function promptTaskScopeSnapshot(
  root: string,
  grantedRoots: string[],
): Map<string, string> {
  const observed = new Map<string, string>()
  const pending = [root]

  for (
    let directory = pending.pop();
    directory !== undefined;
    directory = pending.pop()
  ) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      const relative = path.relative(root, absolute).split(path.sep).join('/')

      if (
        entry.name === '.git' ||
        isProtectedWorkspacePath(relative) ||
        grantedRoots.some((granted) => pathInside(absolute, granted))
      ) {
        continue
      }

      // A symbolic link is neither followed nor fingerprinted: following one
      // can leave the root or cycle, and the target itself is observed where
      // it actually lives.
      if (entry.isDirectory()) {
        pending.push(absolute)
      } else if (entry.isFile()) {
        const stats = statSync(absolute)

        observed.set(relative, `${String(stats.size)}:${String(stats.mtimeMs)}`)
      }
    }
  }

  return observed
}

function promptTaskChangedPaths(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const changed = new Set<string>()

  for (const [relative, fingerprint] of before) {
    if (after.get(relative) !== fingerprint) {
      changed.add(relative)
    }
  }

  for (const relative of after.keys()) {
    if (!before.has(relative)) {
      changed.add(relative)
    }
  }

  return [...changed].sort()
}

/**
 * Where one prompt task runs, and the widest root it is granted by default.
 *
 * A task that declares neither a worktree nor a workspace runs in its own
 * session runtime directory. The harness root was the earlier default, and it
 * handed an unattended launch write reach over the whole installation;
 * `HORIZON-001` now requires an explicit named grant for anything that wide.
 */
function promptTaskWorkspace(
  root: string,
  task: HorizonTask,
  sessionRuntime: string,
): string {
  if (task.worktree) {
    return path.resolve(
      root,
      resolveOrCreateWorktree(root, task.worktree, task.title).path,
    )
  }

  const declared = task.workspace?.trim() ?? ''

  if (declared === '') {
    return sessionRuntime
  }

  const resolved = path.resolve(root, declared)

  // A workspace of `.` reaches the harness root without naming it, which is
  // the default this rule replaced wearing a different spelling.
  if (resolved === path.resolve(root)) {
    fail(
      `Prompt task '${task.id}' declares the harness root as its workspace. ` +
        'Name the roots it needs in `grants` instead, because a whole-root ' +
        'grant must be explicit.',
    )
  }

  return resolved
}

export function executePromptTask(
  root: string,
  state: HorizonSessionState,
  task: HorizonTask,
): { task: HorizonTask; ok: boolean; artifact_path: string; error?: string } {
  const requestPath = writePromptRequest(root, state, task)
  const cardPath = path.posix.join(
    HORIZON_ROOT,
    state.session_id,
    'prompt-tasks',
    `${task.id}.card.md`,
  )
  const card = buildGovernanceCard(root, {
    mode: 'unbound',
    requestPath,
    outputPath: cardPath,
    worktreeName: task.worktree,
    contracts: state.contracts,
  })

  const pipeline = loadPipelineConfig(root)
  // `unbound` is a governance mode rather than a persona, so no pipeline
  // configuration maps it to a model. A prompt task is the session's own
  // top-level agent, which is the persona the configuration does map.
  const mapping = resolvePersonaMapping(pipeline.config, 'orchestrator')

  const sessionRuntime = path.resolve(root, HORIZON_ROOT, state.session_id)
  const workspace = promptTaskWorkspace(root, task, sessionRuntime)
  const namedGrants = (task.grants ?? []).map((grant) => ({
    name: grant.name,
    path: path.resolve(root, grant.path),
  }))
  const grantedRoots = [
    ...new Set([
      workspace,
      sessionRuntime,
      ...namedGrants.map((grant) => grant.path),
    ]),
  ]

  ensureDir(workspace)

  // Enforcement decides the shape of the check. When the boundary holds at
  // the operating system, a write outside the grant cannot happen and no
  // observation is needed. When it does not, the fallback observes the whole
  // root and fails closed on anything it finds.
  const sandbox = resolveWriteSandbox(grantedRoots)
  const enforced = sandbox.mode !== 'none'
  const beforeHarness = enforced
    ? new Map<string, string>()
    : promptTaskScopeSnapshot(root, grantedRoots)

  const result = runCursorAgentSession({
    prompt: `${card.markdown}\n\n## Task\n\n${task.prompt ?? ''}`,
    cwd: workspace,
    workspaceRoot: workspace,
    addDirs: grantedRoots.filter((directory) => directory !== workspace),
    requireTrust: true,
    installationRoot: root,
    model: mapping.model_spec,
    writeRoots: grantedRoots,
  })

  const afterHarness = enforced
    ? new Map<string, string>()
    : promptTaskScopeSnapshot(root, grantedRoots)
  // The snapshot already excludes every granted root, so each observed change
  // is outside the grant by construction.
  const unapprovedChanges = promptTaskChangedPaths(beforeHarness, afterHarness)

  const effectiveError =
    unapprovedChanges.length > 0
      ? `Prompt task changed paths outside its granted roots: ${unapprovedChanges.join(', ')}`
      : result.error
  const effectiveOk = result.ok && unapprovedChanges.length === 0

  const artifactPath = path.posix.join(
    HORIZON_ROOT,
    state.session_id,
    'prompt-tasks',
    `${task.id}.result.json`,
  )
  writeJsonAtomic(resolveInside(root, artifactPath), {
    schema_version: 1,
    task_id: task.id,
    request_path: requestPath,
    card_path: card.path,
    ok: effectiveOk,
    exit_code: result.exit_code,
    timed_out: result.timed_out,
    session_id: result.session_id ?? null,
    reported_model: result.reported_model ?? null,
    error: effectiveError ?? null,
    granted_roots: grantedRoots,
    tool_policy: {
      granted_roots: grantedRoots,
      named_grants: namedGrants,
      per_path_write_policy: false,
      scope_gate: 'scope.no_unapproved_changes',
    },
    scope_check: {
      passed: unapprovedChanges.length === 0,
      enforcement: sandbox.mode,
      enforcement_reason: sandbox.reason,
      observation: enforced ? 'prevented' : 'filesystem',
      // The fallback observes the whole root and excludes no tree. It cannot
      // separate this task's write from a concurrent one, so the basis is
      // recorded beside the result rather than left for a reader to assume.
      ...(enforced
        ? {}
        : {
            attribution: 'observation-window',
            skipped_classes: [...PROMPT_TASK_SKIPPED_CLASSES],
          }),
      unapproved_changes: unapprovedChanges,
    },
    recorded_at: now(),
  })

  return {
    task: {
      ...task,
      status: effectiveOk ? 'succeeded' : 'failed',
      result_path: artifactPath,
    },
    ok: effectiveOk,
    artifact_path: artifactPath,
    ...(effectiveError ? { error: effectiveError } : {}),
  }
}
