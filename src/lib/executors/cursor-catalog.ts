import path from 'node:path'

import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import type { ParsedPersonaMapping } from './mapping.js'

const CATALOG_RELATIVE_PATH = 'governance/registries/cursor_model_catalog.json'

interface CatalogEntry {
  status: 'verified' | 'unverified' | 'rejected'
  evidence: string
  superseded_by?: string
}

interface CursorCatalog {
  models: Map<string, CatalogEntry>
  parameters: Map<string, CatalogEntry>
  effortValues: Map<string, CatalogEntry>
}

function parseEntry(value: Record<string, unknown>): CatalogEntry | null {
  const status = value.status

  if (
    status !== 'verified' &&
    status !== 'unverified' &&
    status !== 'rejected'
  ) {
    return null
  }

  return {
    status,
    evidence: typeof value.evidence === 'string' ? value.evidence : '',
    ...(typeof value.superseded_by === 'string'
      ? { superseded_by: value.superseded_by }
      : {}),
  }
}

/**
 * Load the Cursor catalog registry.
 *
 * The catalog records observations, not permissions. An identifier it does not
 * list is unverified rather than invalid, because the harness cannot enumerate
 * a third-party model catalog it does not own. Rejection is reserved for what
 * was directly observed to fail.
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
    isRecord(source) &&
      Array.isArray(source.models) &&
      Array.isArray(source.parameters),
    `${CATALOG_RELATIVE_PATH} MUST declare models and parameters.`,
    { code: 'INVALID_CURSOR_CATALOG' },
  )

  const models = new Map<string, CatalogEntry>()
  const parameters = new Map<string, CatalogEntry>()
  const effortValues = new Map<string, CatalogEntry>()

  for (const model of source.models) {
    if (!isRecord(model) || typeof model.id !== 'string') {
      continue
    }

    const entry = parseEntry(model)

    if (entry) {
      models.set(model.id, entry)
    }
  }

  for (const parameter of source.parameters) {
    if (!isRecord(parameter) || typeof parameter.name !== 'string') {
      continue
    }

    const entry = parseEntry(parameter)

    if (!entry) {
      continue
    }

    parameters.set(parameter.name, entry)

    if (parameter.name !== 'effort' || !Array.isArray(parameter.values)) {
      continue
    }

    for (const value of parameter.values) {
      if (!isRecord(value) || typeof value.value !== 'string') {
        continue
      }

      const valueEntry = parseEntry(value)

      if (valueEntry) {
        effortValues.set(value.value, valueEntry)
      }
    }
  }

  return { models, parameters, effortValues }
}

/**
 * Resolve one Pancreator Cursor mapping to the executor-native model slug.
 *
 * Only an identifier the catalog records as `rejected` fails here. An
 * unrecorded model, parameter, or effort value passes through: treating an
 * absent entry as an error is how a hardcoded list rejects models Cursor
 * actually supports, and it is the defect this catalog replaced.
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

  const catalog = root ? loadCursorCatalog(root) : null
  const model = catalog?.models.get(mapping.model)

  invariant(
    model?.status !== 'rejected',
    `${source} names Cursor model '${mapping.model}', which the catalog ` +
      `records as rejected: ${model?.evidence ?? ''}`,
    { code: 'UNRESOLVED_CURSOR_MODEL' },
  )

  for (const key of Object.keys(mapping.options)) {
    const parameter = catalog?.parameters.get(key)

    if (parameter?.status !== 'rejected') {
      continue
    }

    const replacement = parameter.superseded_by
      ? ` Use '${parameter.superseded_by}' instead.`
      : ''

    invariant(
      false,
      `${source} uses Cursor parameter '${key}', which the catalog records ` +
        `as rejected: ${parameter.evidence}${replacement}`,
      { code: 'UNRESOLVED_CURSOR_MODEL' },
    )
  }

  const effort = mapping.options.effort
  const effortEntry =
    effort === undefined ? undefined : catalog?.effortValues.get(effort)

  invariant(
    effortEntry?.status !== 'rejected',
    `${source} effort '${effort}' is recorded as rejected: ` +
      `${effortEntry?.evidence ?? ''}`,
    { code: 'UNRESOLVED_CURSOR_MODEL' },
  )

  if (mapping.model === 'auto') {
    invariant(
      Object.keys(mapping.options).length === 0,
      `${source} cannot apply Cursor options to model 'auto'.`,
      { code: 'UNRESOLVED_CURSOR_MODEL' },
    )

    return 'auto'
  }

  // The bracketed spec is Cursor's own native form, so the operator's spec is
  // passed through unchanged. Rewriting it into an effort-suffixed flat slug
  // rested on a refuted claim and produced a string Cursor never generates.
  const options = Object.entries(mapping.options)

  if (options.length === 0) {
    return mapping.model
  }

  const rendered = options
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join(',')

  return `${mapping.model}[${rendered}]`
}
