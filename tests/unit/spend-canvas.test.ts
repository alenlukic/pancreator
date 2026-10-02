/**
 * Unit tests for the spend report canvas renderer.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

import {
  renderSpendCanvas,
  SPEND_CANVAS_TEMPLATE,
  writeSpendCanvas,
  type RenderableSpendReport,
} from '../../src/lib/spend-canvas.js'
import type { SpendMetrics } from '../../src/lib/token-spend.js'
import { createTestTempDirectory } from '../temp.js'

const TEMPLATE = readFileSync(
  path.join(process.cwd(), SPEND_CANVAS_TEMPLATE),
  'utf8',
)

function metrics(
  costCents: number,
  feeCents: number,
  includedCents = 0,
): SpendMetrics {
  return {
    events: 2,
    request_units: 1,
    input_tokens: 10,
    output_tokens: 20,
    cache_write_tokens: 30,
    cache_read_tokens: 940,
    total_tokens: 1000,
    cost_cents: costCents,
    cursor_fee_cents: feeCents,
    included_cost_cents: includedCents,
    included_fee_cents: 0,
  }
}

function coverage(percent: number | null) {
  return {
    known_events: 1,
    total_events: 2,
    known_tokens: 500,
    total_tokens: 1000,
    known_token_percent: percent,
  }
}

function report(): RenderableSpendReport {
  return {
    scope: 'multi-instance',
    period: {
      days: 7,
      start: '2026-09-19T17:00:00.000Z',
      end: '2026-09-26T17:00:00.000Z',
      timezone: 'UTC',
      source: 'Pancreator spend sync',
      cost_basis: 'charged',
    },
    attribution_sources: {
      instances: 1,
      workspaces_scanned: 1,
      embedded_installations_scanned: 0,
    },
    instances: [],
    totals: metrics(500, 100, 150),
    token_categories: {
      input: 10,
      output: 20,
      cache_write: 30,
      cache_read: 940,
      cached: 970,
    },
    daily: [{ date: '2026-09-26', ...metrics(500, 100) }],
    slices: {
      commands: [{ key: 'pan-start', metrics: metrics(500, 100) }],
      persona_models: [],
      tools: [],
      fast_mode: [],
      governance: [],
      workflow_role: [],
      stages: [],
      remediation: [],
    },
    coverage: {
      command: coverage(50),
      persona: coverage(null),
      tools: coverage(80),
      fast_mode: coverage(25),
      governance: coverage(100),
      workflow_role: coverage(50),
      stage: coverage(50),
      remediation: coverage(50),
    },
    warnings: [],
  }
}

test('the canvas embeds the report once and imports only from cursor/canvas', () => {
  const source = renderSpendCanvas(TEMPLATE, report())
  const imports = [...source.matchAll(/from\s+'([^']+)'/gu)].map(
    (match) => match[1],
  )

  assert.ok(!source.includes('__SPEND_REPORT__'))
  assert.equal(source.split('"Pancreator spend sync"').length, 2)
  assert.deepEqual([...new Set(imports)], ['cursor/canvas'])
})

test('a template without exactly one report placeholder is refused', () => {
  for (const template of [
    'no placeholder',
    '__SPEND_REPORT__ __SPEND_REPORT__',
  ]) {
    assert.throws(() => renderSpendCanvas(template, report()), {
      code: 'SPEND_CANVAS_TEMPLATE_INVALID',
    })
  }
})

test('the canvas path must be absolute and end in .canvas.tsx', () => {
  const directory = createTestTempDirectory('pancreator-spend-canvas-')

  for (const canvas of [
    'relative/cost.canvas.tsx',
    path.join(directory, 'cost.tsx'),
  ]) {
    assert.throws(() => writeSpendCanvas(process.cwd(), canvas, report()), {
      code: 'INVALID_ARGUMENT',
    })
  }
})

test('writing the canvas returns its path, totals, and the lowest coverage', () => {
  const directory = createTestTempDirectory('pancreator-spend-canvas-')
  const canvas = path.join(directory, 'cost.canvas.tsx')
  const result = writeSpendCanvas(process.cwd(), canvas, report())

  assert.equal(result.canvas, canvas)
  assert.deepEqual(result.totals, {
    events: 2,
    total_tokens: 1000,
    cost_cents: 500,
    cursor_fee_cents: 100,
    on_demand_cost_cents: 350,
    included_cost_cents: 150,
  })
  assert.deepEqual(result.lowest_coverage, {
    dimension: 'persona',
    known_token_percent: 0,
  })
  assert.ok(readFileSync(canvas, 'utf8').includes('"cost_cents": 500'))
})
