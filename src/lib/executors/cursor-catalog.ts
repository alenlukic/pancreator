import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import { expandCursorModels } from './cursor-catalog-codec.js'
import type { ParsedPersonaMapping } from './mapping.js'

export const LOCAL_CATALOG_RELATIVE_PATH =
  'governance/registries/cursor_model_catalog.json'

/**
 * The one command an operator runs when the catalog no longer resolves the
 * configured specs. Hand-editing the account-local catalog is not a remedy,
 * so every catalog diagnostic names this command instead of the file.
 */
export const CURSOR_CATALOG_REFRESH_COMMAND = './bin/pan models --sync --force'

/** Age past which a recorded catalog capture is reported as stale. */
export const CURSOR_CATALOG_MAX_AGE_DAYS = 30

export interface CursorCatalogModel {
  id: string
  displayName: string
  aliases: string[]
  /** Parameter id → the values Cursor declares for it on this model. */
  parameters: Map<string, Set<string>>
  /** Parameter ids in Cursor's declared order, for display composition. */
  parameterOrder: string[]
  /** Parameter id → value → display fragment, null when the value adds none. */
  valueDisplays: Map<string, Map<string, string | null>>
  /**
   * The declared variant grid as parameter records, or null when the model
   * records none. Valid combinations are not always the full product of
   * parameter values, and a grid may carry hidden dimensions beyond the
   * public parameters (claude-opus-5 declares a `cyber` axis its parameter
   * list omits), so membership is judged by projection onto the keys a spec
   * names.
   */
  variants: Array<Record<string, string>> | null
}

/** Canonical `key=value` summary of a set of bracket options. */
export function variantCombinationKey(options: Record<string, string>): string {
  return Object.entries(options)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',')
}

/**
 * Whether some declared variant agrees with the options on every key the
 * options name. Hidden grid dimensions the spec cannot address are ignored.
 */
export function variantCombinationExists(
  variants: Array<Record<string, string>>,
  options: Record<string, string>,
): boolean {
  return variants.some((variant) =>
    Object.entries(options).every(([key, value]) => variant[key] === value),
  )
}

export interface CursorCatalog {
  /** Canonical model id → model. */
  models: Map<string, CursorCatalogModel>
  /** Alias → canonical model ids carrying it (aliases are not unique). */
  aliases: Map<string, string[]>
  /**
   * ISO-8601 capture time the catalog records, or null when it records none.
   * A catalog written before the field existed stays readable and reports an
   * unrecorded capture, which is judged unknown rather than fresh.
   */
  capturedAt: string | null
}

function parseModel(value: Record<string, unknown>): CursorCatalogModel | null {
  if (typeof value.id !== 'string') {
    return null
  }

  const parameters = new Map<string, Set<string>>()
  const parameterOrder: string[] = []
  const valueDisplays = new Map<string, Map<string, string | null>>()

  if (Array.isArray(value.parameters)) {
    for (const parameter of value.parameters) {
      if (
        !isRecord(parameter) ||
        typeof parameter.id !== 'string' ||
        !Array.isArray(parameter.values)
      ) {
        continue
      }

      const values = parameter.values.filter(isRecord)

      parameterOrder.push(parameter.id)
      parameters.set(
        parameter.id,
        new Set(
          values
            .map((entry) => entry.value)
            .filter((entry): entry is string => typeof entry === 'string'),
        ),
      )
      valueDisplays.set(
        parameter.id,
        new Map(
          values
            .filter(
              (entry): entry is Record<string, unknown> =>
                typeof entry.value === 'string',
            )
            .map((entry) => [
              entry.value as string,
              typeof entry.displayName === 'string' ? entry.displayName : null,
            ]),
        ),
      )
    }
  }

  let variants: Array<Record<string, string>> | null = null

  if (Array.isArray(value.variants) && value.variants.length > 0) {
    variants = []

    for (const variant of value.variants) {
      if (!isRecord(variant) || !Array.isArray(variant.params)) {
        continue
      }

      const options: Record<string, string> = {}

      for (const param of variant.params) {
        if (
          isRecord(param) &&
          typeof param.id === 'string' &&
          typeof param.value === 'string'
        ) {
          options[param.id] = param.value
        }
      }

      variants.push(options)
    }
  }

  return {
    id: value.id,
    displayName:
      typeof value.displayName === 'string' ? value.displayName : value.id,
    aliases: Array.isArray(value.aliases)
      ? value.aliases.filter(
          (alias): alias is string => typeof alias === 'string',
        )
      : [],
    parameters,
    parameterOrder,
    valueDisplays,
    variants,
  }
}

/**
 * The display name Cursor composes for a resolved variant: the model display
 * name followed by each specified value's display fragment in declared
 * parameter order (a value without a fragment, such as `fast=false`,
 * contributes nothing). Observed live: `gpt-5.6-sol[context=272k,
 * reasoning=high,fast=true]` echoes "GPT-5.6 Sol 272K High Fast".
 */
export function expectedVariantDisplayName(
  model: CursorCatalogModel,
  options: Record<string, string>,
): string {
  const fragments = [model.displayName]

  for (const parameter of model.parameterOrder) {
    const value = options[parameter]

    if (value === undefined) {
      continue
    }

    const display = model.valueDisplays.get(parameter)?.get(value)

    if (display) {
      fragments.push(display)
    }
  }

  return fragments.join(' ')
}

/**
 * Load an optional operator-local Cursor model catalog. The catalog's contents
 * reflect one Cursor account and are therefore never shared or installed.
 */
export function loadCursorCatalog(root: string): CursorCatalog | null {
  const sourcePath = path.join(root, LOCAL_CATALOG_RELATIVE_PATH)

  if (!fileExists(sourcePath)) {
    return null
  }

  const source = readJson(sourcePath)

  invariant(
    isRecord(source) && Array.isArray(source.models),
    `${LOCAL_CATALOG_RELATIVE_PATH} MUST carry the Cursor.models.list() ` +
      `result in models[].`,
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

  return {
    models,
    aliases,
    capturedAt:
      typeof source.captured_at === 'string' && source.captured_at.length > 0
        ? source.captured_at
        : null,
  }
}

/** Whether a recorded capture time is older than the staleness bound. */
export function catalogCaptureAgeDays(
  capturedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (capturedAt === null) {
    return null
  }

  const captured = Date.parse(capturedAt)

  if (Number.isNaN(captured)) {
    return null
  }

  return Math.max(
    0,
    Math.floor((now.getTime() - captured) / (24 * 60 * 60 * 1000)),
  )
}

export type CursorCatalogFreshness =
  | 'absent'
  | 'fresh'
  | 'unrecorded_capture'
  | 'aged'
  | 'incomplete'

export interface CursorCatalogStatus {
  present: boolean
  path: string
  captured_at: string | null
  age_days: number | null
  freshness: CursorCatalogFreshness
  stale: boolean
  /** Persona mappings the catalog cannot resolve, with the reason each gave. */
  unresolved: Array<{ source: string; spec: string; reason: string }>
  refresh_command: string
}

/**
 * Report the catalog's freshness without throwing.
 *
 * Config load validates every mapped model against the catalog, so a catalog
 * that predates a configuration change fails every command at load, including
 * the diagnostic command an operator reaches for when a command fails. The
 * diagnostic commands read this report instead.
 */
export function cursorCatalogStatus(
  root: string,
  personaMappings: Iterable<{ source: string; mapping: ParsedPersonaMapping }>,
  now: Date = new Date(),
): CursorCatalogStatus {
  const base = {
    path: LOCAL_CATALOG_RELATIVE_PATH,
    refresh_command: CURSOR_CATALOG_REFRESH_COMMAND,
  }
  let catalog: CursorCatalog | null = null

  try {
    catalog = loadCursorCatalog(root)
  } catch {
    // An unreadable catalog is reported as absent-and-stale rather than
    // raised, because this report exists to survive a broken catalog.
    return {
      ...base,
      present: true,
      captured_at: null,
      age_days: null,
      freshness: 'incomplete',
      stale: true,
      unresolved: [],
    }
  }

  if (catalog === null) {
    return {
      ...base,
      present: false,
      captured_at: null,
      age_days: null,
      freshness: 'absent',
      stale: false,
      unresolved: [],
    }
  }

  const unresolved: CursorCatalogStatus['unresolved'] = []

  for (const { source, mapping } of personaMappings) {
    if (mapping.executor !== 'cursor') {
      continue
    }

    try {
      resolveAgainstCatalog(catalog, mapping, source)
    } catch (error) {
      unresolved.push({
        source,
        spec: mapping.model_spec,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const ageDays = catalogCaptureAgeDays(catalog.capturedAt, now)
  const freshness: CursorCatalogFreshness =
    unresolved.length > 0
      ? 'incomplete'
      : catalog.capturedAt === null || ageDays === null
        ? 'unrecorded_capture'
        : ageDays > CURSOR_CATALOG_MAX_AGE_DAYS
          ? 'aged'
          : 'fresh'

  return {
    ...base,
    present: true,
    captured_at: catalog.capturedAt,
    age_days: ageDays,
    freshness,
    stale: freshness === 'incomplete' || freshness === 'aged',
    unresolved,
  }
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
      `${[...catalog.models.keys()].sort().join(', ')}. The catalog at ` +
      `${LOCAL_CATALOG_RELATIVE_PATH} is stale; refresh it with ` +
      `\`${CURSOR_CATALOG_REFRESH_COMMAND}\`. \`./bin/pan doctor --json\` ` +
      `reports the catalog state and keeps working while it is stale.`,
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
 * Validate a Cursor persona mapping against an available local catalog and
 * return the spec to project. Without one, syntax remains grammar-only. The
 * configured spec is emitted verbatim: bracket notation is Cursor's documented
 * grammar for the subagent `model:` field, a bare id and empty brackets are
 * distinct valid forms, and any rewriting here has historically produced
 * strings Cursor silently degraded on.
 */
export function resolveCursorModelSlug(
  mapping: ParsedPersonaMapping,
  source = 'persona mapping',
  root?: string,
): string {
  return resolveAgainstCatalog(
    root === undefined ? undefined : loadCursorCatalog(root),
    mapping,
    source,
  )
}

/** Resolves a persona mapping against one catalog load. */
export type CursorModelResolver = (
  mapping: ParsedPersonaMapping,
  source?: string,
) => string

/**
 * Load the catalog once and return a resolver for many mappings. The catalog
 * cannot change inside one synchronous unit of work, so one load serves the
 * whole loop.
 */
export function createCursorModelResolver(
  root: string,
  options: { skipCatalog?: boolean } = {},
): CursorModelResolver {
  const catalog = options.skipCatalog ? null : loadCursorCatalog(root)

  return (mapping, source = 'persona mapping') =>
    resolveAgainstCatalog(catalog, mapping, source)
}

/**
 * `catalog` undefined means the caller gave no root, and `catalog` null means
 * the operator has no local catalog. Both keep the spec grammar-only.
 */
function resolveAgainstCatalog(
  catalog: CursorCatalog | null | undefined,
  mapping: ParsedPersonaMapping,
  source: string,
): string {
  invariant(
    mapping.executor === 'cursor',
    `${source} MUST use the cursor executor before model resolution.`,
    { code: 'INVALID_PIPELINE_CONFIG' },
  )

  if (catalog !== undefined) {
    if (catalog === null) {
      return mapping.model_spec
    }

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
    // Cursor, which picks the model's default variant (observed on the
    // since-retired gpt-5.4: the bare id resolved to its 272K High variant).
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

      // Per-value validity is not enough: the catalog's variant grid is not
      // the full product of parameter values (a model may declare a value
      // that only some contexts offer), and Cursor silently falls back to the
      // model's default variant on a non-existent combination.
      if (model.variants && model.variants.length > 0) {
        const specifiedKeys = Object.keys(mapping.options).sort()
        const declared = [
          ...new Set(
            model.variants.map((variant) =>
              variantCombinationKey(
                Object.fromEntries(
                  specifiedKeys
                    .filter((key) => variant[key] !== undefined)
                    .map((key) => [key, variant[key]]),
                ),
              ),
            ),
          ),
        ].sort()

        invariant(
          variantCombinationExists(model.variants, mapping.options),
          `${source}: Cursor model '${model.id}' declares no variant ` +
            `matching '${variantCombinationKey(mapping.options)}'. Valid ` +
            `combinations are not the full product of parameter values. ` +
            `Declared combinations: ` +
            `${declared.slice(0, 24).join('; ')}` +
            `${declared.length > 24 ? '; …' : ''}. If Cursor has shipped ` +
            `new variants, the catalog at ${LOCAL_CATALOG_RELATIVE_PATH} is ` +
            `stale; refresh it with \`${CURSOR_CATALOG_REFRESH_COMMAND}\`.`,
          { code: 'UNRESOLVED_CURSOR_MODEL' },
        )
      }
    }
  }

  return mapping.model_spec
}
