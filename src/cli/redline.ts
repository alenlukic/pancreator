/** `pan redline observe` and `pan redline scan`. */

import { PanError } from '../lib/errors.js'
import { redlineHost } from '../lib/platform-guidance.js'
import { scanVscodeDebugLog } from '../lib/vscode-debug-log.js'
import {
  recordSighting,
  sightingRunForHost,
  sightingsPath,
} from '../lib/watch/redline-sightings.js'

import type { CliContext } from './context.js'
import { option, print, requiredArgument } from './args.js'

function observe({ root, args, json }: CliContext): void {
  const positional = args[1]
  const host = redlineHost(requiredArgument(option(args, '--host'), '--host'))

  if (host === null) {
    throw new PanError('--host is required.', { code: 'INVALID_ARGUMENT' })
  }

  const runId =
    positional && !positional.startsWith('--')
      ? positional
      : sightingRunForHost(root, host)

  if (runId === null) {
    throw new PanError(
      `No single live run has a redline declaration for host ${host}; ` +
        'name the run id.',
      { code: 'SIGHTING_RUN_UNRESOLVED' },
    )
  }

  const sighting = recordSighting(root, runId, {
    host,
    guidanceId: requiredArgument(
      option(args, '--guidance-id'),
      '--guidance-id',
    ),
    action: option(args, '--action'),
    evidence: option(args, '--evidence'),
    sessionId: option(args, '--session-id'),
  })

  print(
    json
      ? sighting
      : `Platform guidance ${sighting.guidance_id} sighted on ${host}; ` +
          `recorded in ${sightingsPath(root, runId)}.`,
    json,
  )
}

function scan({ root, args, json }: CliContext): void {
  const result = scanVscodeDebugLog(
    root,
    requiredArgument(option(args, '--vscode-debug-log'), '--vscode-debug-log'),
    redlineHost(option(args, '--host') ?? 'vscode-local') ?? 'vscode-local',
  )

  if (json) {
    print(result, true)
    return
  }

  const lines = [
    `Scanned ${result.files_scanned} debug log file(s) for ${result.host}.`,
    ...result.matches.map(
      (match) =>
        `- ${match.guidance_id} (${match.category}): ${match.occurrences} ` +
        `occurrence(s) in ${match.files.join(', ')}`,
    ),
  ]

  if (result.matches.length === 0) {
    lines.push('No catalogued platform guidance matched.')
  }

  if (result.unreadable_files.length > 0) {
    lines.push(`Unreadable: ${result.unreadable_files.join(', ')}`)
  }

  print(lines.join('\n'))
}

/** `pan redline <observe|scan>`. */
export function redlineCommand(context: CliContext): void {
  const sub = context.args[0]

  if (sub === 'observe') {
    observe(context)
    return
  }

  if (sub === 'scan') {
    scan(context)
    return
  }

  throw new PanError('Usage: pan redline <observe|scan> ...', {
    code: 'INVALID_ARGUMENT',
  })
}
