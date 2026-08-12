import { spawnSync } from 'node:child_process'

import { invariant } from './errors.js'

const SETUP_TIMEOUT_MS = 10 * 60 * 1000
const SETUP_MAX_BUFFER = 8 * 1024 * 1024

export interface SetupCommandContext {
  /** Names the worktree the failure message points the operator at. */
  label: string
  code: string
}

/**
 * Run the configured preparation commands inside a freshly created worktree.
 *
 * A shell is used deliberately: these commands are reviewed repository
 * configuration rather than agent-generated input, and operators write them as
 * ordinary shell lines. The first failure stops the sequence, because a later
 * command usually depends on an earlier one.
 */
export function runSetupCommands(
  commands: string[],
  worktreePath: string,
  context: SetupCommandContext,
): void {
  for (const command of commands) {
    const result = spawnSync(command, {
      cwd: worktreePath,
      encoding: 'utf8',
      shell: true,
      timeout: SETUP_TIMEOUT_MS,
      maxBuffer: SETUP_MAX_BUFFER,
    })

    invariant(
      result.status === 0,
      `Setup command failed for ${context.label}: ${command}\n` +
        `${result.error?.message || result.stderr || result.stdout || ''}`.trim(),
      { code: context.code },
    )
  }
}
