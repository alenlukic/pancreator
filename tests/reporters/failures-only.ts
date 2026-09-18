/**
 * A node --test reporter that prints only failures and the final summary.
 *
 * When `PAN_TEST_PROFILE` names an absolute JSON path, the reporter also
 * records per-test and per-file durations and writes one profile document at
 * the end of the run. The variable unset leaves the output byte-identical and
 * writes nothing.
 *
 * When `PAN_TEST_FILE_DURATIONS` names an absolute JSON path, the reporter
 * folds this run's per-file durations into the record there, which schedules
 * the next run's test files. Only `bin/run-tests` sets that variable, so a
 * reporter invocation the runner did not schedule cannot rewrite it.
 */
import {
  mkdirSync,
  readdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { TestEvent } from 'node:test/reporters'

import { TEST_PROFILE_ENV } from '../../src/lib/suite-profile.js'
import type {
  SuiteProfile,
  SuiteProfileFile,
  SuiteProfileFixtureCost,
  SuiteProfileTest,
} from '../../src/lib/suite-profile.js'
import type { FileDurationRecord } from '../../src/lib/test-file-order.js'
import { mergeFileDurationRecord } from '../../src/lib/test-file-order.js'
import {
  fileDurationRecordPath,
  fixtureSidecarDirectory,
  fixtureSidecarPrefix,
} from '../../src/lib/suite-profile-env.js'

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

export function readFixtureCost(
  profileTarget: string,
): SuiteProfileFixtureCost | null {
  // The sidecars are merged out of the runner's scratch tree, so the durable
  // profile target receives only the merged document.
  const directory = fixtureSidecarDirectory()
  const prefix = `${fixtureSidecarPrefix(profileTarget)}.`
  let sidecars: string[]

  try {
    sidecars = readdirSync(directory)
      .filter((entry) => entry.startsWith(prefix) && entry.endsWith('.json'))
      .sort()
  } catch {
    return null
  }

  let template_ms = 0
  let clone_ms = 0
  let prepare_ms = 0

  let template_bytes = 0
  let template_files = 0

  for (const sidecar of sidecars) {
    const sidecarPath = path.join(directory, sidecar)

    try {
      const value = JSON.parse(readFileSync(sidecarPath, 'utf8')) as {
        events?: Array<{
          kind: string
          duration_ms: number
          template_bytes?: number
          template_files?: number
        }>
      }

      for (const event of value.events ?? []) {
        if (event.kind === 'template_build') {
          template_ms += event.duration_ms
          template_bytes = Math.max(template_bytes, event.template_bytes ?? 0)
          template_files = Math.max(template_files, event.template_files ?? 0)
        } else if (event.kind === 'template_clone') {
          clone_ms += event.duration_ms
        } else if (event.kind === 'run_prepare') {
          prepare_ms += event.duration_ms
        }
      }
    } catch {
      continue
    } finally {
      rmSync(sidecarPath, { force: true })
    }
  }

  return template_ms === 0 &&
    clone_ms === 0 &&
    prepare_ms === 0 &&
    template_bytes === 0 &&
    template_files === 0
    ? null
    : {
        template_ms,
        clone_ms,
        prepare_ms,
        template_bytes,
        template_files,
      }
}

class ProfileCollector {
  private readonly files = new Map<string, SuiteProfileFile>()
  private readonly tests: SuiteProfileTest[] = []
  private readonly startedAt = Date.now()
  private total: SummaryData | null = null

  constructor(private readonly profileTarget: string | null) {}

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

      // Only the profile document reads per-test rows, so a run that was not
      // asked for one keeps the reporter's work proportional to the record
      // it does write.
      if (this.profileTarget !== null) {
        this.tests.push({
          file,
          name: data.name,
          duration_ms: data.details.duration_ms,
        })
      }

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

    const allTests = [...this.tests].sort(
      (left, right) => right.duration_ms - left.duration_ms,
    )
    const fixtureCost = this.profileTarget
      ? readFixtureCost(this.profileTarget)
      : null

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
      slowest_tests: allTests
        .slice(0, SLOWEST_TEST_LIMIT)
        .map((entry) => ({ ...entry, duration_ms: round(entry.duration_ms) })),
      all_tests: allTests.map((entry) => ({
        ...entry,
        duration_ms: round(entry.duration_ms),
      })),
      ...(fixtureCost ? { fixture_cost: fixtureCost } : {}),
    }
  }

  write(target: string): void {
    writeJsonAtomic(target, this.document(), true)
  }

  writeDurations(target: string): void {
    const files = [...this.files.values()].sort(
      (left, right) => right.duration_ms - left.duration_ms,
    )
    const testCount =
      this.total?.counts.tests ??
      files.reduce((total, entry) => total + entry.test_count, 0)
    const wallClock = this.total?.duration_ms ?? Date.now() - this.startedAt
    const measured: FileDurationRecord = {
      schema_version: 1,
      recorded_at: new Date().toISOString(),
      lane: laneOf(files.map((entry) => entry.file)),
      wall_clock_ms: Math.round(wallClock * 1000) / 1000,
      test_count: testCount,
      files: files.map((entry) => ({
        file: entry.file,
        duration_ms: Math.round(entry.duration_ms * 1000) / 1000,
      })),
    }

    writeJsonAtomic(
      target,
      mergeFileDurationRecord(readJson(target), measured),
      false,
    )
  }
}

function readJson(target: string): unknown {
  try {
    return JSON.parse(readFileSync(target, 'utf8')) as unknown
  } catch {
    return null
  }
}

function writeJsonAtomic(
  target: string,
  value: unknown,
  pretty: boolean,
): void {
  const body = `${pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value)}\n`

  mkdirSync(path.dirname(target), { recursive: true })

  // A gate points this target into a run's evidence directory, which a watch
  // fingerprints and an evidence audit reads. A sibling staging file is
  // visible there for the length of one write, so staging happens in the
  // runner's scratch tree and only the finished document is ever named under
  // the target.
  const staging = fixtureSidecarDirectory()

  mkdirSync(staging, { recursive: true })

  const temporary = path.join(
    staging,
    `${path.basename(target)}.${process.pid}`,
  )

  writeFileSync(temporary, body)

  try {
    renameSync(temporary, target)
  } catch (error) {
    // A rename cannot cross a device. Writing in place is no longer atomic,
    // but losing the record would be worse than a torn read nobody performs.
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      rmSync(temporary, { force: true })
      throw error
    }

    writeFileSync(target, body)
    rmSync(temporary, { force: true })
  }
}

// style: allow style.default_export Node loads a test reporter through its default export.
export default async function* failuresOnly(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const profileTarget = process.env[TEST_PROFILE_ENV]?.trim()
  const absoluteProfileTarget =
    profileTarget && path.isAbsolute(profileTarget) ? profileTarget : null
  const collector = new ProfileCollector(absoluteProfileTarget)

  for await (const event of source) {
    collector.record(event)

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

  const durationRecord = fileDurationRecordPath()

  if (durationRecord) {
    collector.writeDurations(durationRecord)
  }

  if (absoluteProfileTarget) {
    collector.write(absoluteProfileTarget)
  }
}
