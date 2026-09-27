import { accessSync, constants, readFileSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const HOOKS_SOURCE = 'library/cursor/hooks.json'
const HOOK_COMMAND_SUFFIX = 'bin/pan-hook-shell-monitor'
const PAN_RUN_RELATIVE = 'bin/pan-run'

/**
 * Canonical allowlist as declared in DELEGATE-001. The validator checks that
 * the hook's embedded allowlist matches these entries. Both lists must agree
 * for the gate to pass.
 */
export const SHELL_MONITOR_ALLOWLIST: readonly string[] = [
  'git status',
  'git log',
  'git diff',
  'git show',
  'git rev-parse',
  'ls',
  'rg',
  'cat',
  'pwd',
]

type Issue = HandlerResult['issues'][number]

function isExecutable(absolute: string): boolean {
  try {
    accessSync(absolute, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Read the ALLOWLISTED_COMMANDS and ALLOWLISTED_GIT_SUB sets from the hook. */
function readHookAllowlist(hookPath: string): string[] | null {
  let text: string

  try {
    text = readFileSync(hookPath, 'utf8')
  } catch {
    return null
  }

  // Extract the Python ALLOWLISTED_GIT_SUB set and command prefixes.
  // The hook encodes the allowlist as two Python sets:
  //   ALLOWLISTED_GIT_SUB = {"status", "log", "diff", "show", "rev-parse"}
  //   and cmd_name checks for "ls", "cat", "pwd", "rg", "git"
  // We reconstruct the canonical list from those literals.

  const gitSubMatch = /ALLOWLISTED_GIT_SUB\s*=\s*\{([^}]+)\}/u.exec(text)

  if (gitSubMatch === null) {
    return null
  }

  const gitSubs = gitSubMatch[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/gu, ''))
    .filter(Boolean)

  const result: string[] = []

  for (const sub of gitSubs) {
    result.push(`git ${sub}`)
  }

  // Extract non-git allowlisted commands from patterns like:
  //   if cmd_name in ("ls", "cat", "pwd"): return True
  //   if cmd_name == "rg":
  for (const match of text.matchAll(
    /if cmd_name in \(([^)]+)\):\s*return True/gu,
  )) {
    const cmds = match[1]
      .split(',')
      .map((s) => s.trim().replace(/^["']|["']$/gu, ''))
      .filter((c) => c !== '' && c !== 'git')

    result.push(...cmds)
  }

  // Also pick up single-command patterns: if cmd_name == "rg":
  for (const match of text.matchAll(/if cmd_name == ["']([a-z]+)["']:/gu)) {
    const cmd = match[1]

    if (cmd !== '' && cmd !== 'git' && !result.includes(cmd)) {
      result.push(cmd)
    }
  }

  return result.length > 0 ? result : null
}

function allowlistsMatch(
  fromHook: string[],
  canonical: readonly string[],
): boolean {
  const hookSet = new Set(fromHook.map((e) => e.trim()))
  const canonicalSet = new Set(canonical.map((e) => e.trim()))

  if (hookSet.size !== canonicalSet.size) return false

  for (const entry of canonicalSet) {
    if (!hookSet.has(entry)) return false
  }

  return true
}

/**
 * Collect every shell-monitor validation issue under `root`:
 *  - `library/cursor/hooks.json` declares a fail-closed `beforeShellExecution`
 *    entry whose command contains `pan-hook-shell-monitor`.
 *  - `bin/pan-hook-shell-monitor` exists and is executable.
 *  - `bin/pan-run` exists and is executable.
 *  - The hook's embedded allowlist equals the DELEGATE-001 allowlist.
 */
export function collectShellMonitorIssues(root: string): Issue[] {
  const issues: Issue[] = []
  const hooksAbsolute = path.join(root, HOOKS_SOURCE)
  const hookScriptAbsolute = path.join(root, HOOK_COMMAND_SUFFIX)
  const panRunAbsolute = path.join(root, PAN_RUN_RELATIVE)

  // Check bin/pan-hook-shell-monitor exists and is executable
  if (!fileExists(hookScriptAbsolute)) {
    issues.push({
      code: 'shell_monitor.hook_script_missing',
      message: `${HOOK_COMMAND_SUFFIX} is missing.`,
      pointer: HOOK_COMMAND_SUFFIX,
    })
  } else if (!isExecutable(hookScriptAbsolute)) {
    issues.push({
      code: 'shell_monitor.hook_script_not_executable',
      message: `${HOOK_COMMAND_SUFFIX} is not executable.`,
      pointer: HOOK_COMMAND_SUFFIX,
    })
  }

  // Check bin/pan-run exists and is executable
  if (!fileExists(panRunAbsolute)) {
    issues.push({
      code: 'shell_monitor.pan_run_missing',
      message: `${PAN_RUN_RELATIVE} is missing.`,
      pointer: PAN_RUN_RELATIVE,
    })
  } else if (!isExecutable(panRunAbsolute)) {
    issues.push({
      code: 'shell_monitor.pan_run_not_executable',
      message: `${PAN_RUN_RELATIVE} is not executable.`,
      pointer: PAN_RUN_RELATIVE,
    })
  }

  // Check hooks.json declares the fail-closed beforeShellExecution entry
  if (!fileExists(hooksAbsolute)) {
    issues.push({
      code: 'shell_monitor.hooks_source_missing',
      message: `${HOOKS_SOURCE} is missing.`,
      pointer: HOOKS_SOURCE,
    })
    return issues
  }

  let hooks: unknown

  try {
    hooks = readJson(hooksAbsolute)
  } catch {
    issues.push({
      code: 'shell_monitor.hooks_source_unreadable',
      message: `${HOOKS_SOURCE}: could not be read or parsed.`,
      pointer: HOOKS_SOURCE,
    })
    return issues
  }

  if (!isRecord(hooks) || !isRecord(hooks.hooks)) {
    issues.push({
      code: 'shell_monitor.hooks_object_missing',
      message: `${HOOKS_SOURCE}: missing or non-object 'hooks' field.`,
      pointer: HOOKS_SOURCE,
    })
    return issues
  }

  const beforeShellExecution = hooks.hooks.beforeShellExecution

  const monitorEntry =
    Array.isArray(beforeShellExecution) &&
    beforeShellExecution.find(
      (entry): entry is Record<string, unknown> =>
        isRecord(entry) &&
        typeof entry.command === 'string' &&
        entry.command.includes(HOOK_COMMAND_SUFFIX),
    )

  if (!monitorEntry) {
    issues.push({
      code: 'shell_monitor.before_shell_execution_hook_missing',
      message:
        `${HOOKS_SOURCE}: no beforeShellExecution entry whose command ` +
        `contains '${HOOK_COMMAND_SUFFIX}'.`,
      pointer: HOOKS_SOURCE,
    })
    return issues
  }

  if (monitorEntry.failClosed !== true) {
    issues.push({
      code: 'shell_monitor.hook_not_fail_closed',
      message: `${HOOKS_SOURCE}: the shell-monitor hook entry must have failClosed: true.`,
      pointer: HOOKS_SOURCE,
    })
  }

  // Check the allowlist in the hook script matches DELEGATE-001
  if (fileExists(hookScriptAbsolute)) {
    const hookAllowlist = readHookAllowlist(hookScriptAbsolute)

    if (hookAllowlist === null) {
      issues.push({
        code: 'shell_monitor.allowlist_unreadable',
        message: `${HOOK_COMMAND_SUFFIX}: could not extract the allowlist from the hook script.`,
        pointer: HOOK_COMMAND_SUFFIX,
      })
    } else if (!allowlistsMatch(hookAllowlist, SHELL_MONITOR_ALLOWLIST)) {
      issues.push({
        code: 'shell_monitor.allowlist_drift',
        message:
          `${HOOK_COMMAND_SUFFIX}: the hook's embedded allowlist does not match ` +
          `the DELEGATE-001 allowlist. Hook has: [${hookAllowlist.sort().join(', ')}]. ` +
          `Expected: [${[...SHELL_MONITOR_ALLOWLIST].sort().join(', ')}].`,
        pointer: HOOK_COMMAND_SUFFIX,
      })
    }
  }

  return issues
}

/** Registry handler for `SHELL-MONITOR-VALIDATE-001`; `targetPath` is unused. */
export function shellMonitorValidateHandler(
  input: HandlerInput,
): HandlerResult {
  const issues = collectShellMonitorIssues(input.root)

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
