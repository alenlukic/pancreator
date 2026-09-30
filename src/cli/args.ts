/**
 * Argument parsing and output helpers every CLI command shares, and the
 * `--worktree` support check the dispatcher runs before any command.
 */

import path from 'node:path'

import { getRunState } from '../lib/engine/run-status.js'
import type { DeliveryRouteOptions } from '../lib/cohorts/state.js'
import { PanError } from '../lib/errors.js'
import {
  fileExists,
  isFile,
  readText,
  resolveInside,
  toRepoRelative,
} from '../lib/io.js'
import { HELP_BODY, validatePanInvocation } from '../lib/pan-command-grammar.js'
import {
  readWorktreeIndex,
  resolveOrCreateWorktree,
  resolveWorktreeWorkspace,
  type WorktreeRecord,
} from '../lib/worktrees.js'

export function helpText(root: string): string {
  const versionPath = path.join(root, 'VERSION')
  const version = fileExists(versionPath)
    ? readText(versionPath).trim()
    : 'unknown'

  return `Pancreator v${version}

${HELP_BODY}`
}

export function option(
  args: string[],
  name: string,
  fallback: string | null = null,
): string | null {
  const index = args.indexOf(name)

  if (index === -1) {
    return fallback
  }

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} requires a value.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

export function options(args: string[], name: string): string[] {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new PanError(`${name} requires a value.`, {
        code: 'INVALID_ARGUMENT',
      })
    }

    values.push(value)
    index += 1
  }

  return values
}

export function requiredArgument(
  value: string | null | undefined,
  name: string,
): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

/**
 * A required positional argument. A flag in the positional slot, for example
 * `pan cohort release --json`, is a missing positional, not a value, so it is
 * refused as such instead of reaching the command's own validation.
 */
export function requiredPositional(
  value: string | null | undefined,
  name: string,
): string {
  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

export function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

/**
 * Operator note taken from `--note` or from `--note-file <path>`.
 *
 * A full decision packet exceeds what argv carries safely, so the file option
 * is the route the argv refusal names. The two spellings are exclusive so a
 * command never has to choose between two notes.
 */
export function noteOption(
  root: string,
  args: string[],
  fallback: string | null = null,
): string | null {
  const inline = option(args, '--note')
  const notePath = option(args, '--note-file')

  if (inline !== null && notePath !== null) {
    throw new PanError('--note and --note-file cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (notePath === null) {
    return inline ?? fallback
  }

  const absolute = resolveInside(
    root,
    path.isAbsolute(notePath) ? toRepoRelative(root, notePath) : notePath,
  )

  if (!isFile(absolute)) {
    throw new PanError(`--note-file does not name a file: ${notePath}`, {
      code: 'NOTE_FILE_NOT_FOUND',
    })
  }

  return readText(absolute)
}

/** Integer-valued option, or null when absent. A non-integer value is refused. */
export function integerOption(args: string[], name: string): number | null {
  const raw = option(args, name)

  if (raw === null) {
    return null
  }

  const value = Number(raw)

  if (!Number.isInteger(value)) {
    throw new PanError(`${name} requires an integer.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

/**
 * Utility-wide worktree targeting contract.
 *
 * One shared `--worktree <name>` option selects the workspace a command runs
 * against, creating the named worktree when the index does not hold it yet.
 * `acceptsWorktreeOption` declares every command surface that runs against a
 * selectable workspace; every other command rejects the option explicitly so
 * an unsupported use fails loudly instead of being silently ignored.
 * Projected persona and utility commands that delegate outside the CLI bind
 * their workspace through `pan worktree resolve`, which applies the same
 * create-or-resolve behavior to an operator-named worktree.
 */
export const WORKTREE_CAPABLE_SURFACES = [
  'init',
  'decide',
  'away decide',
  'cohort route',
  'horizon init',
  'prepare',
  'resume',
  'submit',
  'author apply|validate',
  'release sync|continue|finalize',
  'conform scan|checkpoint',
  'style scan|checkpoint',
  'repository-check <profile>',
  'requirements run',
  'tests impacted',
  'technologies detect',
  'doctor',
  'governance card',
]

const SUBCOMMAND_STYLE_COMMANDS = new Set([
  'assessment',
  'author',
  'away',
  'cohort',
  'best-of-n',
  'briefs',
  'conform',
  'context',
  'governance',
  'hypervisor',
  'horizon',
  'inbox',
  'installs',
  'observations',
  'output',
  'quality',
  'release',
  'repository-check',
  'requirements',
  'schedule',
  'spotfix',
  'style',
  'technologies',
  'tune',
  'worker',
  'worktree',
])

function acceptsWorktreeOption(command: string, args: string[]): boolean {
  const validation = validatePanInvocation([command, ...args])

  if (validation.surface === null) {
    // These families parse their own subcommand after the shared option gate.
    // Preserve that stable error precedence for an unknown subcommand.
    return command === 'conform' || command === 'release' || command === 'style'
  }

  return validation.unknown_option !== '--worktree'
}

/**
 * Reject `--worktree` on a command surface that does not run against a
 * selected workspace. Exported so a test can hold a projected command file to
 * the command lines this CLI actually accepts, rather than to its own prose.
 */
export function assertWorktreeOptionSupported(
  command: string,
  args: string[],
): void {
  if (!hasFlag(args, '--worktree') || acceptsWorktreeOption(command, args)) {
    return
  }

  const sub = args[0]
  const surface =
    sub && !sub.startsWith('--') && SUBCOMMAND_STYLE_COMMANDS.has(command)
      ? `${command} ${sub}`
      : command

  throw new PanError(
    `'pan ${surface}' does not run against a selected workspace, so it does ` +
      'not accept --worktree. Commands that accept the shared worktree ' +
      `option: ${WORKTREE_CAPABLE_SURFACES.join(', ')}.`,
    { code: 'WORKTREE_OPTION_UNSUPPORTED' },
  )
}

/** Workspace the shared `--worktree <name>` option selects, created on demand. */
export function sharedWorktreeWorkspace(
  root: string,
  args: string[],
  description?: string | null,
): WorktreeRecord | null {
  const name = option(args, '--worktree')

  if (!name) {
    return null
  }

  const record = resolveOrCreateWorktree(
    root,
    name,
    description ?? `Worktree '${name}'`,
  )

  return record
}

/**
 * Check a lifecycle worktree selection against the identity stored at init.
 *
 * The name comparison occurs before worktree resolution, so a conflicting
 * selection cannot create or switch an unrelated worktree.
 */
export function assertRunWorktreeBinding(
  root: string,
  runId: string,
  args: string[],
): void {
  const name = option(args, '--worktree')
  const state = getRunState(root, runId)
  const binding = state.managed_worktree

  if ((name && !binding) || (name && binding?.name !== name)) {
    throw new PanError(
      `Run '${runId}' is bound to worktree ` +
        `'${binding?.name ?? '(none)'}', not '${name}'.`,
      { code: 'RUN_WORKTREE_MISMATCH' },
    )
  }

  if (!binding) {
    return
  }

  const resolved = readWorktreeIndex(root).worktrees.find(
    (entry) => entry.name === binding.name,
  )

  if (
    !resolved ||
    resolved.path !== binding.path ||
    resolved.branch !== binding.branch
  ) {
    throw new PanError(
      `Run '${runId}' worktree identity no longer matches the index.`,
      { code: 'RUN_WORKTREE_IDENTITY_MISMATCH' },
    )
  }

  const resolvedPath = resolveWorktreeWorkspace(root, binding.name)

  if (resolvedPath !== binding.path) {
    throw new PanError(
      `Run '${runId}' resolved worktree path no longer matches its binding.`,
      { code: 'RUN_WORKTREE_IDENTITY_MISMATCH' },
    )
  }
}

/**
 * Comma-separated list option: null when the flag is absent, at least one item
 * when it is present. A present flag that names nothing (`--criteria ,`) is
 * refused rather than read as "no selection", because every caller treats the
 * absent flag as a wider default that the operator did not ask for. An empty
 * segment (`security,` after the shell split `security, performance`) is
 * refused the same way, because dropping it would silently narrow the list.
 */
export function commaSeparatedOption(
  args: string[],
  name: string,
  accepted?: readonly string[],
): string[] | null {
  const value = option(args, name)

  if (value === null) {
    return null
  }

  const items = value.split(',').map((item) => item.trim())

  if (items.some((item) => item.length === 0)) {
    throw new PanError(
      `${name} needs at least one value, comma-separated with no spaces ` +
        `and no empty segment; got '${value}'.` +
        (accepted ? ` Accepted values: ${accepted.join(', ')}.` : ''),
      { code: 'INVALID_ARGUMENT' },
    )
  }

  return items
}

export function repeatedOption(args: string[], name: string): string[] {
  const values: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue
    }

    const value = args[index + 1]

    if (!value || value.startsWith('--')) {
      throw new PanError(`${name} requires a value.`, {
        code: 'INVALID_ARGUMENT',
      })
    }

    values.push(value)
    index += 1
  }

  return values
}

export function print(value: unknown, asJson = false): void {
  if (asJson || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  }
}

/** Operator worktree choice shared by the two commands that route a plan. */
export function deliveryRouteOptions(args: string[]): DeliveryRouteOptions {
  const worktreeName = option(args, '--worktree')

  return worktreeName ? { worktreeName } : {}
}
