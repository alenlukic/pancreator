import { PanError } from '../lib/errors.js'
import {
  checkFunctionIndex,
  writeFunctionIndex,
} from '../lib/function-index.js'
import { isSelfDevelopmentInstallation } from '../lib/project-config.js'
import { hasFlag, print } from './args.js'
import type { CliContext } from './context.js'

/**
 * `pan docs index [--write | --check] [--json]`: regenerate or check the
 * function index of this checkout's `src/`. Self-development only, because
 * the index describes Pancreator's own source. `--check` exits 1 on drift.
 */
export function docsCommand({ root, args, json }: CliContext): void {
  if (args[0] !== 'index') {
    throw new PanError(`Unknown docs subcommand: ${args[0] ?? '(none)'}`, {
      code: 'UNKNOWN_COMMAND',
    })
  }

  if (!isSelfDevelopmentInstallation(root)) {
    throw new PanError(
      'pan docs index describes Pancreator source and runs only in a self-development checkout.',
      { code: 'SELF_DEVELOPMENT_ONLY' },
    )
  }

  const write = hasFlag(args, '--write')

  if (write && hasFlag(args, '--check')) {
    throw new PanError('--write and --check cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const result = write ? writeFunctionIndex(root) : checkFunctionIndex(root)

  print(json ? result : result.message, json)

  if (result.status !== 'current') {
    process.exitCode = 1
  }
}
