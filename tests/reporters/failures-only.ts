/**
 * A node --test reporter that prints only failures and the final summary.
 *
 * The default TAP reporter lists every passing test, so the failing ones are
 * buried in hundreds of `ok` lines when the quiet wrapper replays output.
 * This reporter writes one block per failed test (name, location, error) and
 * one summary line, and nothing for a passing test.
 */
import type { TestEvent } from 'node:test/reporters'

interface FailureData {
  name: string
  file?: string
  line?: number
  column?: number
  details: { error: Error & { cause?: unknown }; duration_ms: number }
}

function formatError(error: Error & { cause?: unknown }): string {
  const cause = error.cause
  if (cause instanceof Error) {
    return cause.stack ?? cause.message
  }
  return error.stack ?? error.message
}

export default async function* failuresOnly(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  for await (const event of source) {
    switch (event.type) {
      case 'test:fail': {
        const data = event.data as FailureData
        const location =
          data.file !== undefined ? ` (${data.file}:${data.line ?? 0})` : ''
        yield `\nnot ok - ${data.name}${location}\n`
        yield `${formatError(data.details.error)
          .split('\n')
          .map((line) => `    ${line}`)
          .join('\n')}\n`
        break
      }
      case 'test:diagnostic': {
        // Only the run summary: node emits `tests`, `pass`, `fail`, and
        // `duration_ms` as diagnostics at the end of the run.
        if (
          /^(tests|pass|fail|cancelled|skipped|todo|duration_ms) /u.test(
            event.data.message,
          )
        ) {
          yield `# ${event.data.message}\n`
        }
        break
      }
      // Passthrough output from tests that spawn the CLI is noise here. A
      // failing test's own error block carries what the reader needs.
      case 'test:stderr':
      case 'test:stdout':
        break
      default:
        break
    }
  }
}
