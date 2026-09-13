import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import path from 'node:path'

import {
  cursorCatalogStatus,
  expectedVariantDisplayName,
  loadCursorCatalog,
  LOCAL_CATALOG_RELATIVE_PATH,
  resolveCursorModelSlug,
} from '../../src/lib/executors/cursor-catalog.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import { createTestTempDirectory } from '../temp.js'

function createCatalogRoot(): string {
  const root = createTestTempDirectory('pancreator-catalog-')
  const catalog = {
    models: [
      {
        id: 'example-gpt',
        displayName: 'Example GPT',
        aliases: ['example'],
        parameters: [
          {
            id: 'context',
            values: [
              { value: '272k', displayName: '272K' },
              { value: '1m', displayName: '1M' },
            ],
          },
          {
            id: 'reasoning',
            values: [
              { value: 'medium', displayName: 'Medium' },
              { value: 'high', displayName: 'High' },
            ],
          },
          {
            id: 'fast',
            values: [
              { value: 'false' },
              { value: 'true', displayName: 'Fast' },
            ],
          },
        ],
        variants: [
          {
            params: [
              { id: 'context', value: '272k' },
              { id: 'reasoning', value: 'high' },
              { id: 'fast', value: 'false' },
            ],
          },
          {
            params: [
              { id: 'context', value: '272k' },
              { id: 'reasoning', value: 'high' },
              { id: 'fast', value: 'true' },
            ],
          },
          {
            params: [
              { id: 'context', value: '1m' },
              { id: 'reasoning', value: 'medium' },
              { id: 'fast', value: 'false' },
            ],
          },
          {
            params: [
              { id: 'context', value: '1m' },
              { id: 'reasoning', value: 'high' },
              { id: 'fast', value: 'false' },
            ],
          },
        ],
      },
      {
        id: 'example-claude',
        displayName: 'Example Claude',
        parameters: [
          {
            id: 'thinking',
            values: [{ value: 'false' }, { value: 'true' }],
          },
          {
            id: 'context',
            values: [
              { value: '300k', displayName: '300K' },
              { value: '1m', displayName: '1M' },
            ],
          },
          {
            id: 'effort',
            values: [
              { value: 'low', displayName: 'Low' },
              { value: 'high', displayName: 'High' },
            ],
          },
        ],
        variants: [
          {
            params: [
              { id: 'thinking', value: 'true' },
              { id: 'context', value: '1m' },
              { id: 'effort', value: 'high' },
            ],
          },
          {
            params: [
              { id: 'thinking', value: 'false' },
              { id: 'context', value: '300k' },
              { id: 'effort', value: 'low' },
            ],
          },
        ],
      },
      {
        id: 'default',
        displayName: 'Default',
        aliases: ['auto'],
        variants: [{ params: [] }],
      },
    ],
  }

  const catalogPath = path.join(
    root,
    'governance',
    'registries',
    'cursor_model_catalog.json',
  )

  mkdirSync(path.dirname(catalogPath), { recursive: true })

  writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`)

  return root
}

const root = createCatalogRoot()

test('a valid spec is emitted verbatim in Cursor bracket grammar', () => {
  // Bracket notation is Cursor's documented grammar for the subagent model
  // field.
  for (const spec of [
    'example-gpt[context=272k,reasoning=high,fast=false]',
    'example-claude[thinking=true,context=1m,effort=high]',
    'auto',
    'example[context=272k,reasoning=high,fast=false]',
  ]) {
    assert.equal(
      resolveCursorModelSlug(
        parsePersonaMapping(spec),
        'persona mapping',
        root,
      ),
      spec,
    )
  }
})

test('parameters are validated per model, not per family', () => {
  const rejections: Array<[string, RegExp]> = [
    [
      'example-gpt[context=272k,effort=high,fast=false]',
      /has no parameter 'effort'/u,
    ],
    ['example-claude[reasoning=high]', /has no parameter 'reasoning'/u],
    [
      'example-gpt[context=272k,reasoning=invalid,fast=false]',
      /parameter 'reasoning' has no value 'invalid'/u,
    ],
    ['example-claude[]', /missing parameter/u],
    ['example-claude[context=1m,effort=high]', /missing parameter/u],
    ['unknown-model', /not in the Cursor model catalog/u],
    [
      'example-gpt[context=1m,reasoning=high,fast=true]',
      /declares no variant matching 'context=1m,fast=true,reasoning=high'/u,
    ],
  ]

  for (const [spec, message] of rejections) {
    assert.throws(
      () =>
        resolveCursorModelSlug(
          parsePersonaMapping(spec),
          'persona mapping',
          root,
        ),
      message,
    )
  }

  for (const spec of [
    'example-gpt[context=1m,reasoning=high,fast=false]',
    'example-gpt[context=272k,reasoning=high,fast=true]',
  ]) {
    assert.equal(
      resolveCursorModelSlug(
        parsePersonaMapping(spec),
        'persona mapping',
        root,
      ),
      spec,
    )
  }
})

test('without a local catalog the resolution is grammar-only', () => {
  const rootWithoutCatalog = createTestTempDirectory(
    'pancreator-catalog-empty-',
  )

  assert.equal(loadCursorCatalog(rootWithoutCatalog), null)
  assert.equal(
    resolveCursorModelSlug(
      parsePersonaMapping('unknown-model[foo=bar]'),
      'persona mapping',
      rootWithoutCatalog,
    ),
    'unknown-model[foo=bar]',
  )

  assert.equal(
    resolveCursorModelSlug(parsePersonaMapping('unknown-model[foo=bar]')),
    'unknown-model[foo=bar]',
  )
})

test('the catalog composes the display name a resolved variant echoes', () => {
  const catalog = loadCursorCatalog(root)
  const exampleGpt = catalog?.models.get('example-gpt')

  assert.ok(exampleGpt)
  assert.equal(
    expectedVariantDisplayName(exampleGpt, {
      context: '272k',
      reasoning: 'high',
      fast: 'true',
    }),
    'Example GPT 272K High Fast',
  )
  assert.equal(
    expectedVariantDisplayName(exampleGpt, {
      context: '272k',
      reasoning: 'high',
      fast: 'false',
    }),
    'Example GPT 272K High',
  )
})

test('catalog status reports staleness and never throws on a broken catalog', () => {
  const mappings = [
    { source: 'balanced.coder', mapping: parsePersonaMapping('example-gpt') },
    {
      source: 'balanced.planner',
      mapping: parsePersonaMapping('missing-model'),
    },
  ]
  const absent = cursorCatalogStatus(
    createTestTempDirectory('pancreator-catalog-status-absent-'),
    [],
  )

  assert.equal(absent.present, false)
  assert.equal(absent.freshness, 'absent')
  assert.equal(absent.stale, false)
  assert.equal(absent.refresh_command, './bin/pan models --sync --force')

  // A catalog with no recorded capture is unknown, not fresh.
  const unrecorded = cursorCatalogStatus(root, [mappings[0]])

  assert.equal(unrecorded.freshness, 'unrecorded_capture')
  assert.equal(unrecorded.captured_at, null)

  // A model the catalog does not hold makes the catalog incomplete, and the
  // report names the mapping rather than raising.
  const incomplete = cursorCatalogStatus(root, mappings)

  assert.equal(incomplete.freshness, 'incomplete')
  assert.equal(incomplete.stale, true)
  assert.deepEqual(
    incomplete.unresolved.map((entry) => entry.source),
    ['balanced.planner'],
  )
  assert.match(incomplete.unresolved[0]?.reason ?? '', /--sync --force/u)

  const datedRoot = createTestTempDirectory('pancreator-catalog-status-aged-')
  const catalogPath = path.join(datedRoot, LOCAL_CATALOG_RELATIVE_PATH)

  mkdirSync(path.dirname(catalogPath), { recursive: true })
  writeFileSync(
    catalogPath,
    `${JSON.stringify({
      captured_at: '2026-01-01T00:00:00.000Z',
      models: [{ id: 'example-gpt', variants: [{ params: [] }] }],
    })}\n`,
  )

  const aged = cursorCatalogStatus(
    datedRoot,
    [],
    new Date('2026-09-13T00:00:00.000Z'),
  )

  assert.equal(aged.freshness, 'aged')
  assert.equal(aged.stale, true)
  assert.ok((aged.age_days ?? 0) > 30)

  const fresh = cursorCatalogStatus(
    datedRoot,
    [],
    new Date('2026-01-10T00:00:00.000Z'),
  )

  assert.equal(fresh.freshness, 'fresh')
  assert.equal(fresh.stale, false)

  // A malformed catalog is the case the report exists for: it survives.
  const brokenRoot = createTestTempDirectory('pancreator-catalog-status-bad-')
  const brokenPath = path.join(brokenRoot, LOCAL_CATALOG_RELATIVE_PATH)

  mkdirSync(path.dirname(brokenPath), { recursive: true })
  writeFileSync(brokenPath, '{ not json\n')

  const broken = cursorCatalogStatus(brokenRoot, mappings)

  assert.equal(broken.freshness, 'incomplete')
  assert.equal(broken.stale, true)
})
