import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import { expandCursorModels } from './cursor-catalog-codec.js'
import type { ParsedPersonaMapping } from './mapping.js'

const CATALOG_RELATIVE_PATH = 'governance/registries/cursor_model_catalog.json'

export interface CursorCatalogModel {
  id: string
  aliases: string[]
  /** Parameter id → the values Cursor declares for it on this model. */
  parameters: Map<string, Set<string>>
}

export interface CursorCatalog {
  /** Canonical model id → model. */
  models: Map<string, CursorCatalogModel>
  /** Alias → canonical model ids carrying it (aliases are not unique). */
  aliases: Map<string, string[]>
}

function parseModel(value: Record<string, unknown>): CursorCatalogModel | null {
  if (typeof value.id !== 'string') {
    return null
  }

  const parameters = new Map<string, Set<string>>()

  if (Array.isArray(value.parameters)) {
    for (const parameter of value.parameters) {
      if (
        !isRecord(parameter) ||
        typeof parameter.id !== 'string' ||
        !Array.isArray(parameter.values)
      ) {
        continue
      }

      parameters.set(
        parameter.id,
        new Set(
          parameter.values
            .filter(isRecord)
            .map((entry) => entry.value)
            .filter((entry): entry is string => typeof entry === 'string'),
        ),
      )
    }
  }

  return {
    id: value.id,
    aliases: Array.isArray(value.aliases)
      ? value.aliases.filter(
          (alias): alias is string => typeof alias === 'string',
        )
      : [],
    parameters,
  }
}

/**
 * Load the Cursor model catalog: the verbatim `Cursor.models.list()` result
 * shipped as a governance registry. Unlike its hand-curated predecessor, this
 * catalog is complete for its retrieval date, so an unknown model or parameter
 * is a configuration error rather than an unverified guess — Cursor's own
 * failure mode for an unusable spec is silent fallback, never a loud error, so
 * this validation is the only loud failure the operator gets.
 */
export function loadCursorCatalog(root: string): CursorCatalog {
  const sourcePath = path.join(root, CATALOG_RELATIVE_PATH)

  invariant(
    fileExists(sourcePath),
    `${CATALOG_RELATIVE_PATH} is missing. The installation MUST ship the ` +
      `Cursor model catalog.`,
    { code: 'INVALID_CURSOR_CATALOG' },
  )

  const source = readJson(sourcePath)

  invariant(
    isRecord(source) && Array.isArray(source.models),
    `${CATALOG_RELATIVE_PATH} MUST carry the Cursor.models.list() result in ` +
      `models[].`,
    { code: 'INVALID_CURSOR_CATALOG' },
  )

  const models = new Map<string, CursorCatalogModel>()
  const aliases = new Map<string, string[]>()

  // The registry stores models in a lossless compact encoding (see the codec);
  // a freshly pasted verbatim Cursor.models.list() result is equally valid.
  for (const entry of expandCursorModels(source.models)) {
    if (!isRecord(entry)) {
      continue
    }

    const model = parseModel(entry)

    if (!model) {
      continue
    }

    models.set(model.id, model)

    for (const alias of model.aliases) {
      const holders = aliases.get(alias) ?? []

      holders.push(model.id)
      aliases.set(alias, holders)
    }
  }

  return { models, aliases }
}

function catalogModel(
  catalog: CursorCatalog,
  requested: string,
  source: string,
): CursorCatalogModel {
  const direct = catalog.models.get(requested)

  if (direct) {
    return direct
  }

  const holders = catalog.aliases.get(requested) ?? []

  invariant(
    holders.length > 0,
    `${source} names Cursor model '${requested}', which is not in the ` +
      `Cursor model catalog. Known models: ` +
      `${[...catalog.models.keys()].sort().join(', ')}. If Cursor has ` +
      `shipped a new model, refresh ` +
      `governance/registries/cursor_model_catalog.json from ` +
      `Cursor.models.list().`,
    { code: 'UNRESOLVED_CURSOR_MODEL' },
  )

  // An alias like `opus` points at several generations. Cursor resolves it to
  // one of them; Pancreator only needs a parameter schema, and the first
  // holder is the newest in list order.
  const resolved = catalog.models.get(holders[0])

  invariant(resolved, `Catalog alias '${requested}' resolves to nothing.`, {
    code: 'INVALID_CURSOR_CATALOG',
  })

  return resolved
}

/**
 * Validate a Cursor persona mapping against the catalog and return the spec
 * to project. The configured spec is emitted verbatim: bracket notation is
 * Cursor's documented grammar for the subagent `model:` field, a bare id and
 * empty brackets are distinct valid forms, and any rewriting here has
 * historically produced strings Cursor silently degraded on.
 */
export function resolveCursorModelSlug(
  mapping: ParsedPersonaMapping,
  source = 'persona mapping',
  root?: string,
): string {
  invariant(
    mapping.executor === 'cursor',
    `${source} MUST use the cursor executor before model resolution.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  if (root !== undefined) {
    const catalog = loadCursorCatalog(root)
    const model = catalogModel(catalog, mapping.model, source)

    for (const [key, value] of Object.entries(mapping.options)) {
      const values = model.parameters.get(key)

      invariant(
        values !== undefined,
        `${source}: Cursor model '${model.id}' has no parameter '${key}'. ` +
          `Declared parameters: ` +
          `${[...model.parameters.keys()].sort().join(', ') || 'none'}. ` +
          `Parameters are per-model (GPT families use 'reasoning'; Claude, ` +
          `Grok, and Gemini families use 'effort'). Cursor silently falls ` +
          `back to the default variant on an unknown parameter, so this ` +
          `MUST be fixed rather than projected.`,
        { code: 'UNRESOLVED_CURSOR_MODEL' },
      )

      invariant(
        values.has(value),
        `${source}: Cursor model '${model.id}' parameter '${key}' has no ` +
          `value '${value}'. Declared values: ${[...values].join(', ')}.`,
        { code: 'UNRESOLVED_CURSOR_MODEL' },
      )
    }

    // A bracketed spec must specify every declared parameter. Observed
    // 2026-08-17 on the cursor-agent CLI: partial bracket specs
    // (claude-fable-5[], claude-opus-5[context=300k,effort=high]) fail with
    // "Cannot use this model" while fully-specified forms resolve exactly. A
    // bare id (no brackets) is valid and delegates the variant choice to
    // Cursor (bare gpt-5.4 resolved to "GPT-5.4 272K High").
    if (mapping.model_spec.includes('[')) {
      for (const name of model.parameters.keys()) {
        invariant(
          name in mapping.options,
          `${source}: Cursor model '${model.id}' bracket spec is missing ` +
            `parameter '${name}'. Specify every declared parameter ` +
            `(${[...model.parameters.keys()].sort().join(', ')}) or use the ` +
            `bare model id; the Cursor CLI rejects partial bracket specs.`,
          { code: 'UNRESOLVED_CURSOR_MODEL' },
        )
      }
    }
  }

  return mapping.model_spec
}
