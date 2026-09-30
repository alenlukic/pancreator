#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { assertArgvElementsWithinLimit } from './lib/argv-limits.js'
import { errorMessage, PanError } from './lib/errors.js'
import { findProjectRoot } from './lib/io.js'
import { panCommand } from './lib/project-config/resolve.js'
import type { CliContext } from './cli/context.js'
import {
  assertWorktreeOptionSupported,
  hasFlag,
  helpText,
  print,
} from './cli/args.js'
import {
  abortCommand,
  assessCommand,
  attributeCommand,
  decideCommand,
  delegateCommand,
  initCommand,
  involvementCommand,
  pauseCommand,
  prepareCommand,
  resumeCommand,
  setStageCommand,
  submitCommand,
  verificationCommand,
  waiveGateCommand,
} from './cli/run-lifecycle.js'
import { awayCommand, hypervisorCommand } from './cli/supervision.js'
import {
  conformCommand,
  repositoryCheckCommand,
  styleCommand,
  technologiesCommand,
  testsCommand,
} from './cli/checks.js'
import { debloatCommand, releaseCommand, tuneCommand } from './cli/release.js'
import {
  archiveCommand,
  cleanupCommand,
  inboxCommand,
  installsCommand,
  listCommand,
  observationsCommand,
  qualityCommand,
  spendCommand,
  statusCommand,
  worktreeCommand,
} from './cli/workspace.js'
import {
  authorCommand,
  briefsCommand,
  governanceCommand,
  modelsCommand,
  validationMapCommand,
} from './cli/governance.js'
import {
  bestOfNCommand,
  cohortCommand,
  horizonCommand,
  scheduleCommand,
} from './cli/orchestration.js'
import { requirementsCommand } from './cli/requirements.js'
import {
  assessmentCommand,
  contextCommand,
  outputCommand,
  prDescriptionCommand,
  spotfixCommand,
  workerCommand,
} from './cli/stage.js'
import { watchCommand } from './cli/watch.js'
import {
  doctorCommand,
  evalCommand,
  handoffCommand,
  validateCommand,
} from './cli/diagnostics.js'
export { HELP_BODY } from './lib/pan-command-grammar.js'
export {
  assertWorktreeOptionSupported,
  requiredPositional,
  WORKTREE_CAPABLE_SURFACES,
} from './cli/args.js'
export { requirementShapeKey } from './cli/requirements.js'
export { preSubmitRequirements } from './cli/stage.js'

async function main(): Promise<void> {
  const root = findProjectRoot()
  const help = helpText(root)
  const pan = panCommand(root)
  const rawArgs = process.argv.slice(2)

  // The refusal runs on the assembled argument list, before dispatch, so an
  // oversized value fails with a named error rather than after run resolution.
  assertArgvElementsWithinLimit(rawArgs)

  const [command = 'help', ...args] = rawArgs
  const json = hasFlag(args, '--json')

  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    print(help)
    return
  }

  assertWorktreeOptionSupported(command, args)

  const context: CliContext = {
    root,
    help,
    pan,
    rawArgs,
    command,
    args,
    json,
  }

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(help)
      return
    case 'init':
      return initCommand(context)
    case 'prepare':
      return prepareCommand(context)
    case 'delegate':
      return delegateCommand(context)
    case 'submit':
      return submitCommand(context)
    case 'assess':
      return assessCommand(context)
    case 'decide':
      return decideCommand(context)
    case 'involvement':
      return involvementCommand(context)
    case 'verification':
      return verificationCommand(context)
    case 'pause':
      return pauseCommand(context)
    case 'attribute':
      return attributeCommand(context)
    case 'resume':
      return resumeCommand(context)
    case 'set-stage':
      return setStageCommand(context)
    case 'waive-gate':
      return waiveGateCommand(context)
    case 'abort':
      return abortCommand(context)
    case 'hypervisor':
      return hypervisorCommand(context)
    case 'away':
      return awayCommand(context)
    case 'technologies':
      return technologiesCommand(context)
    case 'conform':
      return conformCommand(context)
    case 'style':
      return styleCommand(context)
    case 'repository-check':
      return repositoryCheckCommand(context)
    case 'tests':
      return testsCommand(context)
    case 'release':
      return releaseCommand(context)
    case 'tune':
      return tuneCommand(context)
    case 'debloat':
      return debloatCommand(context)
    case 'worktree':
      return worktreeCommand(context)
    case 'status':
      return statusCommand(context)
    case 'list':
      return listCommand(context)
    case 'installs':
      return installsCommand(context)
    case 'inbox':
      return inboxCommand(context)
    case 'observations':
      return observationsCommand(context)
    case 'archive':
      return archiveCommand(context)
    case 'quality':
      return qualityCommand(context)
    case 'spend':
      return spendCommand(context)
    case 'cleanup':
      return cleanupCommand(context)
    case 'models':
      return modelsCommand(context)
    case 'briefs':
      return briefsCommand(context)
    case 'validation-map':
      return validationMapCommand(context)
    case 'author':
      return authorCommand(context)
    case 'governance':
      return governanceCommand(context)
    case 'best-of-n':
      return bestOfNCommand(context)
    case 'schedule':
      return scheduleCommand(context)
    case 'horizon':
      return horizonCommand(context)
    case 'cohort':
      return cohortCommand(context)
    case 'context':
      return contextCommand(context)
    case 'pr-description':
      return prDescriptionCommand(context)
    case 'requirements':
      return requirementsCommand(context)
    case 'output':
      return outputCommand(context)
    case 'assessment':
      return assessmentCommand(context)
    case 'spotfix':
      return spotfixCommand(context)
    case 'worker':
      return workerCommand(context)
    case 'watch':
      return watchCommand(context)
    case 'validate':
      return validateCommand(context)
    case 'eval':
      return evalCommand(context)
    case 'handoff':
      return handoffCommand(context)
    case 'doctor':
      return doctorCommand(context)
    default:
      throw new PanError(`Unknown command: ${command}\n\n${help}`, {
        code: 'UNKNOWN_COMMAND',
      })
  }
}

/**
 * Whether `argvPath` names this module, so a direct run executes `main` and an
 * import does not.
 *
 * A read the guard cannot perform is not an answer. Swallowing the failure
 * returned "not the entrypoint", which exits 0 having run no command: the
 * operator sees a silent success where the CLI never started.
 */
export function cliEntrypointMatches(argvPath: string): boolean {
  let resolved: string

  try {
    resolved = realpathSync(argvPath)
  } catch (error) {
    throw new PanError(
      `Failed to resolve the invoked entrypoint path: ${argvPath}`,
      {
        code: 'ENTRYPOINT_PATH_UNREADABLE',
        details: { cause: errorMessage(error) },
      },
    )
  }

  return resolved === fileURLToPath(import.meta.url)
}

if (process.argv[1] !== undefined && cliEntrypointMatches(process.argv[1])) {
  main().catch((error: unknown) => {
    const known = error instanceof PanError
    const message = error instanceof Error ? error.message : String(error)
    const payload = {
      error: known ? error.code : 'UNEXPECTED_ERROR',
      message,
      ...(known && error.details !== undefined
        ? { details: error.details }
        : {}),
    }

    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
    process.exitCode = known ? error.exitCode : 1
  })
}
