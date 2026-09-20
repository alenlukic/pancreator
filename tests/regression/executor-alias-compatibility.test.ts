import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { syncCursorProjection } from '../../src/lib/projection.js'
import { createFixture } from '../helpers.js'

test('moving a persona to openai prunes its projected cursor subagent', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs?: Record<string, Record<string, unknown>>
  }

  syncCursorProjection(root, { write: true })

  const projected = path.join(root, '.cursor/agents/pan-planner.md')

  assert.ok(existsSync(projected), 'a cursor persona owns a projected agent')

  config.defaults.planner = 'openai:gpt-6-astra[effort=high]'

  for (const named of Object.values(config.configs ?? {})) {
    delete named.planner

    if (typeof named.personas === 'object' && named.personas !== null) {
      delete (named.personas as Record<string, unknown>).planner
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  syncCursorProjection(root, { write: true })

  // An externally executed persona has no Cursor subagent to launch, so a
  // stale one left behind would be a live route to the wrong runtime.
  assert.equal(existsSync(projected), false)

  // The neighbouring cursor personas keep theirs.
  assert.ok(existsSync(path.join(root, '.cursor/agents/pan-coder.md')))
})
