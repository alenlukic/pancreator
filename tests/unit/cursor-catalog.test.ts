import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import path from 'node:path'

import {
  expectedVariantDisplayName,
  loadCursorCatalog,
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
