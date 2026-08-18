import { invariant } from '../errors.js'
import { isRecord } from '../io.js'

/**
 * Lossless codec for the Cursor model catalog's `models` array.
 *
 * The verbatim `Cursor.models.list()` result spends most of its bytes on
 * `variants`: per-model grids where every entry repeats `{id, value}` objects
 * and the model display name. The grids carry real information — valid
 * parameter combinations are not always the full product, one combination is
 * the default, and a few variants carry their own display names — so they are
 * re-encoded, not dropped:
 *
 * - `variant_keys`: the parameter-id order shared by every variant.
 * - `variants`: one `|`-joined value tuple per variant, original order.
 * - `default_variant`: the tuple flagged `isDefault`, when present.
 * - `variant_names`: tuple → display name, only where it differs from the
 *   model display name.
 *
 * `compressCursorModels` verifies its own output by expanding it and checking
 * deep equality with the input; a model whose shape defeats the encoding is
 * kept verbatim rather than approximated. Either form is valid registry
 * content: the loader expands compact entries transparently.
 */

const TUPLE_DELIMITER = '|'

interface VerbatimVariant {
  params: { id: string; value: string }[]
  displayName?: string
  isDefault?: boolean
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    )
  }

  if (isRecord(a) && isRecord(b)) {
    const aKeys = Object.keys(a).filter((key) => a[key] !== undefined)
    const bKeys = Object.keys(b).filter((key) => b[key] !== undefined)

    return (
      aKeys.length === bKeys.length &&
      aKeys.every((key) => deepEqual(a[key], b[key]))
    )
  }

  return false
}

function verbatimVariants(value: unknown): VerbatimVariant[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const variants: VerbatimVariant[] = []

  for (const entry of value) {
    if (!isRecord(entry) || !Array.isArray(entry.params)) {
      return null
    }

    for (const key of Object.keys(entry)) {
      if (key !== 'params' && key !== 'displayName' && key !== 'isDefault') {
        return null
      }
    }

    const params: { id: string; value: string }[] = []

    for (const param of entry.params) {
      if (
        !isRecord(param) ||
        typeof param.id !== 'string' ||
        typeof param.value !== 'string' ||
        Object.keys(param).length !== 2 ||
        param.id.includes(TUPLE_DELIMITER) ||
        param.value.includes(TUPLE_DELIMITER)
      ) {
        return null
      }

      params.push({ id: param.id, value: param.value })
    }

    variants.push({
      params,
      ...(typeof entry.displayName === 'string'
        ? { displayName: entry.displayName }
        : {}),
      ...(entry.isDefault === true ? { isDefault: true } : {}),
    })
  }

  return variants
}

/** True when a models-array entry uses the compact variant encoding. */
export function isCompactModel(entry: unknown): boolean {
  return (
    isRecord(entry) &&
    Array.isArray(entry.variant_keys) &&
    Array.isArray(entry.variants) &&
    entry.variants.every((item) => typeof item === 'string')
  )
}

function compactOneModel(
  model: Record<string, unknown>,
): Record<string, unknown> {
  const variants = verbatimVariants(model.variants)

  if (!variants || variants.length === 0) {
    return model
  }

  const modelName =
    typeof model.displayName === 'string' ? model.displayName : ''
  const keys = variants[0].params.map((param) => param.id)
  const tuples: string[] = []
  const names: Record<string, string> = {}
  let defaultTuple: string | undefined

  for (const variant of variants) {
    if (
      variant.params.length !== keys.length ||
      !variant.params.every((param, index) => param.id === keys[index]) ||
      variant.displayName === undefined
    ) {
      return model
    }

    const tuple = variant.params
      .map((param) => param.value)
      .join(TUPLE_DELIMITER)

    tuples.push(tuple)

    if (variant.displayName !== modelName) {
      names[tuple] = variant.displayName
    }

    if (variant.isDefault) {
      if (defaultTuple !== undefined) {
        return model
      }

      defaultTuple = tuple
    }
  }

  const { variants: _dropped, ...rest } = model

  return {
    ...rest,
    variant_keys: keys,
    variants: tuples,
    ...(defaultTuple !== undefined ? { default_variant: defaultTuple } : {}),
    ...(Object.keys(names).length > 0 ? { variant_names: names } : {}),
  }
}

function expandOneModel(
  entry: Record<string, unknown>,
): Record<string, unknown> {
  if (!isCompactModel(entry)) {
    return entry
  }

  const keys = (entry.variant_keys as unknown[]).filter(
    (key): key is string => typeof key === 'string',
  )
  const modelName =
    typeof entry.displayName === 'string' ? entry.displayName : ''
  const names = isRecord(entry.variant_names) ? entry.variant_names : {}
  const defaultTuple =
    typeof entry.default_variant === 'string'
      ? entry.default_variant
      : undefined

  const variants = (entry.variants as string[]).map((tuple) => {
    const values =
      tuple === '' && keys.length === 0 ? [] : tuple.split(TUPLE_DELIMITER)

    invariant(
      values.length === keys.length,
      `Compact Cursor catalog entry '${String(entry.id)}' has a variant ` +
        `tuple '${tuple}' that does not match its ${keys.length} variant keys.`,
      { code: 'INVALID_CURSOR_CATALOG' },
    )

    const name = names[tuple]

    return {
      params: keys.map((id, index) => ({ id, value: values[index] })),
      displayName: typeof name === 'string' ? name : modelName,
      ...(tuple === defaultTuple ? { isDefault: true } : {}),
    }
  })

  const {
    variant_keys: _keys,
    variant_names: _names,
    default_variant: _default,
    ...rest
  } = entry

  return { ...rest, variants }
}

/**
 * Expand a models array in either form to the verbatim
 * `Cursor.models.list()` shape.
 */
export function expandCursorModels(models: unknown[]): unknown[] {
  return models.map((entry) =>
    isRecord(entry) ? expandOneModel(entry) : entry,
  )
}

/**
 * Compress a verbatim models array. Losslessness is enforced, not assumed:
 * the result is expanded and compared deep-equal against the input, and any
 * model that fails round-trips verbatim instead.
 */
export function compressCursorModels(models: unknown[]): unknown[] {
  return models.map((entry) => {
    if (!isRecord(entry)) {
      return entry
    }

    if (isCompactModel(entry)) {
      return entry
    }

    const compact = compactOneModel(entry)

    return deepEqual(expandOneModel(compact), entry) ? compact : entry
  })
}
