import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import type { TestEvent } from 'node:test/reporters'

import inventoryReporter, {
  TEST_INVENTORY_ENV,
} from '../reporters/inventory.js'
import { createTestTempDirectory } from '../temp.js'

interface TestIdentityRow {
  file: string
  name: string
  lane: string
  line?: number
  occurrence?: number
}

function startEvent(name: string, line: number): TestEvent {
  return {
    type: 'test:start',
    data: {
      name,
      file: path.join(process.cwd(), 'dist/tests/unit/duplicate.test.js'),
      line,
      nesting: 0,
    },
  } as unknown as TestEvent
}

async function drain(events: TestEvent[]): Promise<void> {
  async function* source(): AsyncGenerator<TestEvent> {
    for (const event of events) {
      yield event
    }
  }

  for await (const _chunk of inventoryReporter(source())) {
    // The reporter prints nothing; the inventory is its output.
  }
}

test('the inventory reporter keeps duplicate top-level names', async () => {
  const inventoryPath = path.join(
    createTestTempDirectory('pan-tune-inventory-'),
    'inventory.json',
  )
  const previous = process.env[TEST_INVENTORY_ENV]

  process.env[TEST_INVENTORY_ENV] = inventoryPath

  try {
    await drain([startEvent('same name', 2), startEvent('same name', 3)])
  } finally {
    if (previous === undefined) {
      delete process.env[TEST_INVENTORY_ENV]
    } else {
      process.env[TEST_INVENTORY_ENV] = previous
    }
  }

  const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8')) as {
    identities: TestIdentityRow[]
  }

  assert.equal(inventory.identities.length, 2)
  assert.deepEqual(
    inventory.identities.map((item) => item.occurrence),
    [undefined, 2],
  )
})
