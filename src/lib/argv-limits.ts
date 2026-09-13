import { PanError } from './errors.js'

/**
 * Largest argument the CLI will pass through argv.
 *
 * Endpoint security on an operator machine SIGKILLs a process at exec time
 * once a single argv element reaches 1000 bytes, which is why a delegation
 * prompt travels over stdin (`src/lib/executors/cursor-agent.ts`). The kill
 * lands before Node starts, so nothing prints and the run is unchanged. The
 * bound sits below that limit so the refusal comes from code that runs.
 */
export const ARGV_ELEMENT_BYTE_LIMIT = 900

/** Option whose value is too large for argv, with the size that refused it. */
export interface OversizedArgvElement {
  /** Option the value belongs to, or `null` for a positional argument. */
  option: string | null
  index: number
  byteLength: number
}

export function argvElementByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function findOversizedArgvElement(
  args: readonly string[],
  limit: number = ARGV_ELEMENT_BYTE_LIMIT,
): OversizedArgvElement | null {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index] ?? ''
    const byteLength = argvElementByteLength(value)

    if (byteLength < limit) {
      continue
    }

    const previous = args[index - 1]

    return {
      option: previous?.startsWith('--') ? previous : null,
      index,
      byteLength,
    }
  }

  return null
}

/**
 * Refuse an oversized argument before the command dispatches.
 *
 * The check runs on the assembled argument list rather than inside a command
 * handler, so an oversized note is refused with a named error instead of
 * reaching run resolution and instead of the silent exec-time kill.
 */
export function assertArgvElementsWithinLimit(
  args: readonly string[],
  limit: number = ARGV_ELEMENT_BYTE_LIMIT,
): void {
  const oversized = findOversizedArgvElement(args, limit)

  if (!oversized) {
    return
  }

  const subject = oversized.option
    ? `The value of ${oversized.option}`
    : `Argument ${oversized.index + 1}`
  const fileOption = oversized.option === '--note' ? ' Use --note-file.' : ''

  throw new PanError(
    `${subject} is ${oversized.byteLength} bytes, at or above the ${limit}-byte ` +
      'argv limit, so it cannot pass through the command line safely.' +
      `${fileOption} The run is unchanged.`,
    {
      code: 'ARGV_ELEMENT_TOO_LARGE',
      details: {
        option: oversized.option,
        argument_index: oversized.index,
        byte_length: oversized.byteLength,
        byte_limit: limit,
      },
    },
  )
}
