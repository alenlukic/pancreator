import {
  listProceduralExceptions,
  recordProceduralException,
  reconcileProceduralExceptions,
  resolveProceduralException,
} from '../lib/procedural-exceptions.js'
import { PanError } from '../lib/errors.js'
import type { CliContext } from './context.js'
import { hasFlag, option, print, requiredArgument } from './args.js'

export function exceptionsCommand({ root, args }: CliContext): void {
  const [action, run] = args
  const runId = requiredArgument(run, 'run-id')
  switch (action) {
    case 'record':
      print(
        recordProceduralException(
          root,
          runId,
          requiredArgument(option(args, '--file'), '--file'),
        ),
      )
      return
    case 'list':
      print(
        listProceduralExceptions(root, runId, {
          unresolved: hasFlag(args, '--unresolved'),
          ...(option(args, '--id') ? { id: option(args, '--id')! } : {}),
        }),
      )
      return
    case 'resolve':
      print(
        resolveProceduralException(
          root,
          runId,
          requiredArgument(option(args, '--entry'), '--entry'),
          requiredArgument(option(args, '--file'), '--file'),
        ),
      )
      return
    case 'reconcile':
      print(
        reconcileProceduralExceptions(
          root,
          runId,
          requiredArgument(option(args, '--artifact'), '--artifact'),
        ),
      )
      return
    default:
      throw new PanError(
        'exception requires record, list, resolve, or reconcile.',
        { code: 'INVALID_ARGUMENT' },
      )
  }
}
