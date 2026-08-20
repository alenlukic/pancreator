import { spawnSync } from 'node:child_process'

import { isRecord } from '../io.js'
import {
  expectedVariantDisplayName,
  loadCursorCatalog,
  type CursorCatalog,
} from './cursor-catalog.js'
import { parsePersonaMapping } from './mapping.js'

const PROBE_TIMEOUT_MS = 120_000
const PROBE_PROMPT = 'Reply with the single word OK.'

export interface CursorModelProbe {
  spec: string
  personas: string[]
  /** Variant display name Cursor's init event echoed, null when unreadable. */
  resolved: string | null
  /**
   * Variant display name the catalog predicts for this spec. Null for a bare
   * id or `auto`, whose variant choice is delegated to Cursor.
   */
  expected: string | null
  ok: boolean
  error?: string
}

/**
 * Launch one minimal cursor-agent call and read the variant name the
 * `system`/`init` event echoes. This is the only observable proof of what a
 * spec actually resolves to: Cursor's failure mode for an unusable spec is
 * silent fallback to the model's default variant, never an error.
 */
export function probeCursorModelSpec(
  spec: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): { resolved: string | null; error?: string } {
  const result = spawnSync(
    'cursor-agent',
    [
      '-p',
      '--output-format',
      'stream-json',
      '--mode',
      'ask',
      '--trust',
      '--model',
      spec,
      PROBE_PROMPT,
    ],
    {
      encoding: 'utf8',
      // cursor-agent consumes stdin; an open stream hangs the probe.
      input: '',
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    },
  )

  if (result.error) {
    return {
      resolved: null,
      error: `cursor-agent could not run: ${result.error.message}. Probes need the cursor-agent CLI and CURSOR_API_KEY or a cursor-agent login.`,
    }
  }

  for (const line of (result.stdout ?? '').split('\n')) {
    const trimmed = line.trim()

    if (trimmed.length === 0) {
      continue
    }

    let event: unknown

    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }

    if (
      isRecord(event) &&
      event.type === 'system' &&
      event.subtype === 'init' &&
      typeof event.model === 'string'
    ) {
      return { resolved: event.model }
    }
  }

  const stderr = (result.stderr ?? '').trim().split('\n').slice(-3).join(' ')

  return {
    resolved: null,
    error:
      stderr.length > 0
        ? stderr.slice(0, 300)
        : `no system/init event (exit ${String(result.status)})`,
  }
}

export function expectedCursorModelForSpec(
  root: string,
  spec: string,
): string | null {
  return expectedFor(loadCursorCatalog(root), spec)
}

function expectedFor(
  catalog: CursorCatalog | null,
  spec: string,
): string | null {
  if (catalog === null || !spec.includes('[')) {
    return null
  }

  const mapping = parsePersonaMapping(spec, 'probe')
  const model =
    catalog.models.get(mapping.model) ??
    catalog.models.get(catalog.aliases.get(mapping.model)?.[0] ?? '')

  return model ? expectedVariantDisplayName(model, mapping.options) : null
}

/**
 * Probe every distinct cursor-executor model spec of the active pipeline
 * config against live Cursor and compare the resolved variant with an
 * available local catalog's prediction. Static validation proves a spec is
 * well-formed for that catalog; this proves what it launches today.
 */
export function probeCursorModels(
  root: string,
  personas: Record<string, string>,
): CursorModelProbe[] {
  const catalog = loadCursorCatalog(root)
  const bySpec = new Map<string, string[]>()

  for (const [persona, raw] of Object.entries(personas)) {
    const mapping = parsePersonaMapping(raw, persona)

    if (mapping.executor !== 'cursor') {
      continue
    }

    const holders = bySpec.get(mapping.model_spec) ?? []

    holders.push(persona)
    bySpec.set(mapping.model_spec, holders)
  }

  const probes: CursorModelProbe[] = []

  for (const [spec, specPersonas] of [...bySpec.entries()].sort()) {
    const expected = expectedFor(catalog, spec)
    const { resolved, error } = probeCursorModelSpec(spec)
    const ok = resolved !== null && (expected === null || resolved === expected)

    probes.push({
      spec,
      personas: specPersonas.sort(),
      resolved,
      expected,
      ok,
      ...(error ? { error } : {}),
    })
  }

  return probes
}
