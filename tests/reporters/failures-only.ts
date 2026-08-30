/**
 * A node --test reporter that prints only failures and the final summary.
 *
 * When `PAN_TEST_PROFILE` names an absolute JSON path, the reporter also
 * records per-test and per-file durations and writes one profile document at
 * the end of the run. The variable unset leaves the output byte-identical and
 * writes nothing.
 */
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TestEvent } from 'node:test/reporters'

import { TEST_PROFILE_ENV } from '../../src/lib/suite-profile.js'
import type {
  SuiteProfile,
  SuiteProfileFile,
  SuiteProfileTest,
} from '../../src/lib/suite-profile.js'

const SLOWEST_TEST_LIMIT = 15

interface FailureData {
  name: string
  file?: string
  line?: number
  column?: number
  details: { error: Error & { cause?: unknown }; duration_ms: number }
}

interface PassData {
  name: string
  nesting: number
  file?: string
  details: { duration_ms: number; type?: string }
}

interface SummaryData {
  file?: string
  counts: { tests: number; passed: number; failed?: number }
  duration_ms: number
}

function formatError(error: Error & { cause?: unknown }): string {
  const cause = error.cause
  if (cause instanceof Error) {
    return cause.stack ?? cause.message
  }
  return error.stack ?? error.message
}

function realPath(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    return target
  }
}

/**
 * Runner events name the same file by its argument path and by its real path,
 * so both resolve through the filesystem before they key a file entry.
 */
function relativeFile(file: string): string {
  const relative = path.relative(realPath(process.cwd()), realPath(file))

  return relative.startsWith('..') ? file : relative.split(path.sep).join('/')
}

/** Lane names inferred from the test file paths, joined with `+`. */
function laneOf(files: string[]): string {
  const lanes = new Set<string>()

  for (const file of files) {
    const match = /(?:^|\/)tests\/([a-z0-9_-]+)\//u.exec(file)

    if (match) {
      lanes.add(match[1])
    }
  }

  return lanes.size > 0 ? [...lanes].sort().join('+') : 'unknown'
}

class ProfileCollector {
  private readonly files = new Map<string, SuiteProfileFile>()
  private readonly tests: SuiteProfileTest[] = []
  private readonly startedAt = Date.now()
  private total: SummaryData | null = null

  private fileEntry(file: string): SuiteProfileFile {
    let entry = this.files.get(file)

    if (!entry) {
      entry = {
        file,
        duration_ms: 0,
        test_count: 0,
        pass_count: 0,
        fail_count: 0,
      }
      this.files.set(file, entry)
    }

    return entry
  }

  record(event: TestEvent): void {
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      const data = event.data as PassData
      const file = data.file ? relativeFile(data.file) : 'unknown'

      // A suite's duration already covers its children.
      if (data.details.type === 'suite') {
        return
      }

      const entry = this.fileEntry(file)
      entry.test_count += 1

      if (event.type === 'test:pass') {
        entry.pass_count += 1
      } else {
        entry.fail_count += 1
      }

      // A per-file summary replaces the summed duration when the runner
      // emits one; until then the sum stands in.
      entry.duration_ms += data.details.duration_ms
      this.tests.push({
        file,
        name: data.name,
        duration_ms: data.details.duration_ms,
      })
      return
    }

    if (event.type === 'test:summary') {
      const data = event.data as SummaryData

      if (data.file) {
        const entry = this.fileEntry(relativeFile(data.file))
        entry.duration_ms = data.duration_ms
      } else {
        this.total = data
      }
    }
  }

  document(): SuiteProfile {
    const files = [...this.files.values()].sort(
      (left, right) => right.duration_ms - left.duration_ms,
    )
    const round = (value: number): number => Math.round(value * 1000) / 1000
    const sum = (select: (entry: SuiteProfileFile) => number): number =>
      files.reduce((total, entry) => total + select(entry), 0)

    return {
      schema_version: 1,
      lane: laneOf(files.map((entry) => entry.file)),
      recorded_at: new Date().toISOString(),
      test_count: this.total?.counts.tests ?? sum((entry) => entry.test_count),
      pass_count: this.total?.counts.passed ?? sum((entry) => entry.pass_count),
      fail_count: this.total?.counts.failed ?? sum((entry) => entry.fail_count),
      wall_clock_ms: round(
        this.total?.duration_ms ?? Date.now() - this.startedAt,
      ),
      files: files.map((entry) => ({
        ...entry,
        duration_ms: round(entry.duration_ms),
      })),
      slowest_tests: [...this.tests]
        .sort((left, right) => right.duration_ms - left.duration_ms)
        .slice(0, SLOWEST_TEST_LIMIT)
        .map((entry) => ({ ...entry, duration_ms: round(entry.duration_ms) })),
    }
  }

  write(target: string): void {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, `${JSON.stringify(this.document(), null, 2)}\n`)
  }
}

export default async function* failuresOnly(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const profileTarget = process.env[TEST_PROFILE_ENV]?.trim()
  const collector =
    profileTarget && path.isAbsolute(profileTarget)
      ? new ProfileCollector()
      : null

  for await (const event of source) {
    collector?.record(event)

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

  if (collector && profileTarget) {
    collector.write(profileTarget)
  }
}
