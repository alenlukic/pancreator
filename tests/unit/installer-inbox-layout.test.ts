import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { INBOX_WORK_STATUSES } from '../../src/lib/inbox.js'

const INSTALLER = readFileSync(
  path.join(process.cwd(), 'bin', 'install'),
  'utf8',
)

test('a fresh install scaffolds every inbox lifecycle directory', () => {
  const declaration = /INBOX_STATUS_DIRECTORIES=\(([^)]*)\)/u.exec(INSTALLER)

  assert.ok(declaration, 'bin/install declares INBOX_STATUS_DIRECTORIES')
  assert.deepEqual(declaration[1].trim().split(/\s+/u), [
    ...INBOX_WORK_STATUSES,
    'archive',
  ])

  const preparation = /prepare_persistent_layout\(\) \{\n([\s\S]*?)\n\}/u.exec(
    INSTALLER,
  )

  assert.ok(preparation, 'bin/install declares prepare_persistent_layout')
  assert.match(preparation[1], /INBOX_STATUS_DIRECTORIES\[@\]/u)
  assert.match(preparation[1], /mkdir -p "\$INBOX_DIR\/\$inbox_status"/u)
})
