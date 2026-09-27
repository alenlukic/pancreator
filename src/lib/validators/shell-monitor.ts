import { accessSync, constants, readFileSync } from 'node:fs'
import path from 'node:path'

import { fileExists, isRecord, readJson } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

const HOOKS_SOURCE = 'library/cursor/hooks.json'
const HOOK_COMMAND_SUFFIX = 'bin/pan-hook-shell-monitor'
const PAN_RUN_RELATIVE = 'bin/pan-run'
const POLICY_SOURCE = 'governance/policies/DELEGATE-001.json'
const POLICY_ALLOWLIST_LEAD = 'The allowlist contains:'

type Issue = HandlerResult['issues'][number]

function isExecutable(absolute: string): boolean {
  try {
    accessSync(absolute, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Read the `ALLOWLIST = [...]` literal the hook's evaluator derives every
 * allowed command from. Returns null when the literal is absent or malformed.
 */
function readHookAllowlist(hookPath: string): string[] | null {
  let text: string

  try {
    text = readFileSync(hookPath, 'utf8')
  } catch {
    return null
  }

  const match = /^ALLOWLIST = (\[.*\])$/mu.exec(text)

  if (match === null) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(match[1])

    return Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : null
  } catch {
    return null
  }
}

/**
 * Read the backticked entries of the DELEGATE-001 instruction sentence that
 * opens with `The allowlist contains:`. Returns null when no instruction
 * states the allowlist.
 */
function readPolicyAllowlist(policyPath: string): string[] | null {
  let policy: unknown

  try {
    policy = readJson(policyPath)
  } catch {
    return null
  }

  if (!isRecord(policy) || !Array.isArray(policy.instructions)) {
    return null
  }

  for (const instruction of policy.instructions) {
    const text =
      typeof instruction === 'string'
        ? instruction
        : isRecord(instruction) && typeof instruction.text === 'string'
          ? instruction.text
          : ''
    const lead = text.indexOf(POLICY_ALLOWLIST_LEAD)

    if (lead === -1) {
      continue
    }

    const sentence = text
      .slice(lead + POLICY_ALLOWLIST_LEAD.length)
      .split(/\.(?:\s|$)/u)[0]
    const entries = [...sentence.matchAll(/`([^`]+)`/gu)].map(
      (entry) => entry[1],
    )

    return entries.length > 0 ? entries : null
  }

  return null
}

function sameEntries(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftSet = new Set(left)
  const rightSet = new Set(right)

  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((entry) => rightSet.has(entry))
  )
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

  if (!fileExists(hookScriptAbsolute)) {
    return issues
  }

  const hookAllowlist = readHookAllowlist(hookScriptAbsolute)
  const policyAllowlist = readPolicyAllowlist(path.join(root, POLICY_SOURCE))

  if (hookAllowlist === null) {
    issues.push({
      code: 'shell_monitor.allowlist_unreadable',
      message: `${HOOK_COMMAND_SUFFIX}: could not read the ALLOWLIST literal from the hook script.`,
      pointer: HOOK_COMMAND_SUFFIX,
    })
  }

  if (policyAllowlist === null) {
    issues.push({
      code: 'shell_monitor.policy_allowlist_unreadable',
      message: `${POLICY_SOURCE}: no instruction states '${POLICY_ALLOWLIST_LEAD}' with backticked entries.`,
      pointer: POLICY_SOURCE,
    })
  }

  if (
    hookAllowlist !== null &&
    policyAllowlist !== null &&
    !sameEntries(hookAllowlist, policyAllowlist)
  ) {
    issues.push({
      code: 'shell_monitor.allowlist_drift',
      message:
        `${HOOK_COMMAND_SUFFIX}: the hook's embedded allowlist does not match ` +
        `the ${POLICY_SOURCE} allowlist. Hook has: [${[...hookAllowlist].sort().join(', ')}]. ` +
        `Policy states: [${[...policyAllowlist].sort().join(', ')}].`,
      pointer: HOOK_COMMAND_SUFFIX,
    })
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
