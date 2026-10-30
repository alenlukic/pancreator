/** `pan intake`: request size, integration, and route classification. */

import { PanError } from '../lib/errors.js'
import {
  readIntakeRecord,
  recordIntakeClassification,
  type IntakeRecord,
} from '../lib/intake/record.js'

import type { CliContext } from './context.js'
import {
  hasFlag,
  integerOption,
  option,
  options,
  print,
  requiredArgument,
} from './args.js'

export function intakeCommand({ root, pan, args, json }: CliContext): void {
  const subcommand = args[0]
  const request = requiredArgument(option(args, '--request'), '--request')

  if (subcommand === 'classify') {
    const record = recordIntakeClassification({
      root,
      request,
      estimate: {
        sloc: requiredInteger(args, '--sloc'),
        tssrfs: requiredInteger(args, '--tssrfs'),
        modules: requiredInteger(args, '--modules'),
        layers: options(args, '--layer'),
        newIntegrationPoints: hasFlag(args, '--new-integration-point'),
      },
      rationale: requiredArgument(option(args, '--rationale'), '--rationale'),
      augmented: option(args, '--augmented') ?? undefined,
      operatorWorkflow: option(args, '--operator-workflow') ?? undefined,
      reason: option(args, '--reason') ?? undefined,
    })

    emit(record, pan, json)
    return
  }

  if (subcommand === 'show') {
    const record = readIntakeRecord(root, request)

    if (record === null) {
      throw new PanError(`No intake record for ${request}.`, {
        code: 'INTAKE_RECORD_NOT_FOUND',
      })
    }

    emit(record, pan, json)
    return
  }

  throw new PanError('Usage: pan intake classify|show --request <file>.', {
    code: 'INVALID_ARGUMENT',
  })
}

function requiredInteger(args: string[], name: string): number {
  const value = integerOption(args, name)

  if (value === null) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

function emit(record: IntakeRecord, pan: string, json: boolean): void {
  const nextCommand = intakeNextCommand(record, pan)

  if (json) {
    print({ ...record, next_command: nextCommand }, true)
    return
  }

  const { current } = record
  const { start } = current
  const startLine =
    start.kind === 'decompose'
      ? `Start: ${start.command} (size ${current.size_class} needs chunks of M or smaller)`
      : `Start: ${start.workflow} workflow (${start.source}${start.reason ? `: ${start.reason}` : ''})`

  print(
    [
      `Request: ${record.request}`,
      `Size: ${current.size_class} (${current.estimate.sloc} SLOC, ${current.estimate.tssrfs} TSSRFs, ${current.estimate.modules} modules)`,
      `Layers: ${current.estimate.layers.join(', ')}`,
      `Integration: ${current.integration ? 'yes' : 'no'}; new integration point: ${current.new_integration_points ? 'yes' : 'no'}`,
      `Route: ${current.route.join(' → ')}`,
      startLine,
      `Rationale: ${current.rationale}`,
      ...(current.reclassification_reason
        ? [`Reclassified: ${current.reclassification_reason}`]
        : []),
      `Next: ${nextCommand}`,
    ].join('\n'),
  )
}

/** Command that starts the recorded route. */
export function intakeNextCommand(record: IntakeRecord, pan: string): string {
  const { start } = record.current

  if (start.kind === 'decompose') {
    return `${start.command} ${record.augmented_request?.path ?? record.request}`
  }

  return [
    `${pan} init --request ${record.request}`,
    ...(start.workflow === 'planning' ? [] : [`--workflow ${start.workflow}`]),
    ...(record.augmented_request
      ? [`--context-reference ${record.augmented_request.path}`]
      : []),
  ].join(' ')
}
