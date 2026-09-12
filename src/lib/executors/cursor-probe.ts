import { spawn, spawnSync } from 'node:child_process'
import { isRecord } from '../io.js'
import {
  expectedVariantDisplayName,
  loadCursorCatalog,
  type CursorCatalog,
} from './cursor-catalog.js'
import {
  resetCursorAgentCapabilities,
  withSupportedFlags,
} from './cursor-agent.js'
import { parsePersonaMapping } from './mapping.js'

export { resetCursorAgentCapabilities }

const PROBE_TIMEOUT_MS = 120_000
const PROBE_PROMPT = 'Reply with the single word OK.'
const PROBE_PREREQUISITES =
  'Probes need the cursor-agent CLI and CURSOR_API_KEY (from the process ' +
  'environment, the installation .env, or the workspace-root .env) or a ' +
  'cursor-agent login.'

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

import { probeEnvironment } from './cursor-auth.js'

export {
  cursorAuthenticationReadiness,
  probeEnvironment,
  type CursorApiKeySource,
  type CursorAuthenticationReadiness,
  type CursorDotEnvInspection,
} from './cursor-auth.js'

/**
 * Launch one minimal cursor-agent call and read the variant name the
 * `system`/`init` event echoes. This is the only observable proof of what a
 * spec actually resolves to: Cursor's failure mode for an unusable spec is
 * silent fallback to the model's default variant, never an error.
 */
export function probeCursorModelSpec(
  spec: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  env?: NodeJS.ProcessEnv,
): { resolved: string | null; error?: string } {
  const result = spawnSync('cursor-agent', probeArguments(spec, env), {
    encoding: 'utf8',
    // cursor-agent consumes stdin; an open stream hangs the probe.
    input: '',
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    ...(env ? { env } : {}),
  })

  if (result.error) {
    return {
      resolved: null,
      error: `cursor-agent could not run: ${result.error.message}. ${PROBE_PREREQUISITES}`,
    }
  }

  return readProbeStreams(
    result.stdout ?? '',
    result.stderr ?? '',
    result.status,
  )
}

function probeArguments(spec: string, env?: NodeJS.ProcessEnv): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    ...withSupportedFlags([['--mode', 'ask'], ['--trust']], env),
    '--model',
    spec,
    PROBE_PROMPT,
  ]
}

/**
 * Resolve one spec without holding the calling thread. The synchronous probe
 * stays for the run-scoped path, which already runs inside a detached child
 * and must spend exactly one live model call.
 */
export function probeCursorModelSpecAsync(
  spec: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  env?: NodeJS.ProcessEnv,
): Promise<{ resolved: string | null; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn('cursor-agent', probeArguments(spec, env), {
      timeout: timeoutMs,
      ...(env ? { env } : {}),
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (result: {
      resolved: string | null
      error?: string
    }): void => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) =>
      finish({
        resolved: null,
        error: `cursor-agent could not run: ${error.message}. ${PROBE_PREREQUISITES}`,
      }),
    )
    // cursor-agent consumes stdin; an open stream hangs the probe.
    child.stdin.end()
    child.on('close', (code) => finish(readProbeStreams(stdout, stderr, code)))
  })
}

/** Read the variant name a probe echoed, or the best available diagnosis. */
function readProbeStreams(
  stdout: string,
  stderr: string,
  status: number | null,
): { resolved: string | null; error?: string } {
  for (const line of stdout.split('\n')) {
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

  const tail = stderr.trim().split('\n').slice(-3).join(' ')

  return {
    resolved: null,
    error:
      tail.length > 0
        ? tail.slice(0, 300)
        : `no system/init event (exit ${String(status)})`,
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
 *
 * Every spec resolves together, because an operator waiting on this command
 * has no reason to pay for one round trip after another.
 */
export async function probeCursorModels(
  root: string,
  personas: Record<string, string>,
): Promise<CursorModelProbe[]> {
  const catalog = loadCursorCatalog(root)
  const env = probeEnvironment(root)
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

  // Sorted first so the concurrent results keep the order the serial probe
  // produced: the output is an operator-facing report, not a race result.
  return Promise.all(
    [...bySpec.entries()]
      .sort()
      .map(async ([spec, specPersonas]): Promise<CursorModelProbe> => {
        const expected = expectedFor(catalog, spec)
        const { resolved, error } = await probeCursorModelSpecAsync(
          spec,
          PROBE_TIMEOUT_MS,
          env,
        )

        return {
          spec,
          personas: specPersonas.sort(),
          resolved,
          expected,
          ok: resolved !== null && (expected === null || resolved === expected),
          ...(error ? { error } : {}),
        }
      }),
  )
}
