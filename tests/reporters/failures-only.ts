/** A node --test reporter that prints only failures and the final summary. */
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
        if (
          /^(tests|pass|fail|cancelled|skipped|todo|duration_ms) /u.test(
            event.data.message,
          )
        ) {
          yield `# ${event.data.message}\n`
        }
        break
      }
      // Drop test output. The failure block carries what the reader needs.
      case 'test:stderr':
      case 'test:stdout':
        break
      default:
        break
    }
  }
}
