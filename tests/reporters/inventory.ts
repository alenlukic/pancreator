/**
 * Inventory-only reporter: collect stable test identities without asserting.
 *
 * Set `PAN_TEST_INVENTORY` to an absolute JSON path. Run with
 * `--test-name-pattern=^$` so test bodies do not execute.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { TestEvent } from 'node:test/reporters'

export const TEST_INVENTORY_ENV = 'PAN_TEST_INVENTORY'

interface PlannedTest {
  name: string
  file?: string
  line?: number
}

function relativeFile(file: string): string {
  const relative = path.relative(process.cwd(), file)
  const normalized = relative.startsWith('..')
    ? file
    : relative.split(path.sep).join('/')

  return normalized
    .replace(/^dist\/tests\//u, 'tests/')
    .replace(/\.js$/u, '.ts')
}

function laneOf(file: string): string {
  const match = /(?:^|\/)tests\/([a-z0-9_-]+)\//u.exec(file)

  return match?.[1] ?? 'unknown'
}

class InventoryCollector {
  private readonly tests = new Map<string, PlannedTest>()

  record(event: TestEvent): void {
    if (event.type !== 'test:start' && event.type !== 'test:plan') {
      return
    }

    const data = event.data as unknown as PlannedTest & {
      nesting?: number
      type?: string
    }

    if (data.type === 'suite' || (data.nesting ?? 0) > 0 || !data.name) {
      return
    }

    const file = data.file ? relativeFile(data.file) : 'unknown'

    const key = `${file}\0${data.name}\0${data.line ?? 'unknown'}`

    this.tests.set(key, {
      name: data.name,
      file,
      ...(data.line !== undefined ? { line: data.line } : {}),
    })
  }

  identities(): Array<{
    file: string
    name: string
    lane: string
    line?: number
    occurrence?: number
  }> {
    const counts = new Map<string, number>()
    const rows: Array<{
      file: string
      name: string
      lane: string
      line?: number
      occurrence?: number
    }> = []

    for (const entry of this.tests.values()) {
      const base = `${entry.file}\0${entry.name}`
      const next = (counts.get(base) ?? 0) + 1
      counts.set(base, next)

      rows.push({
        file: entry.file ?? 'unknown',
        name: entry.name,
        lane: laneOf(entry.file ?? 'unknown'),
        ...(entry.line !== undefined ? { line: entry.line } : {}),
        ...(next > 1 ? { occurrence: next } : {}),
      })
    }

    return rows.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        left.name.localeCompare(right.name) ||
        (left.occurrence ?? 1) - (right.occurrence ?? 1),
    )
  }

  write(target: string): void {
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(
      target,
      `${JSON.stringify(
        {
          schema_version: 1,
          recorded_at: new Date().toISOString(),
          identities: this.identities(),
        },
        null,
        2,
      )}\n`,
    )
  }
}

export default async function* inventoryReporter(
  source: AsyncIterable<TestEvent>,
): AsyncGenerator<string> {
  const target = process.env[TEST_INVENTORY_ENV]?.trim()
  const collector =
    target && path.isAbsolute(target) ? new InventoryCollector() : null

  for await (const event of source) {
    collector?.record(event)
  }

  if (collector && target) {
    collector.write(target)
  }
}
