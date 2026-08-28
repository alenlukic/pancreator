import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { fileExists, isRecord, readText } from '../io.js'
import { readProjectConfig } from '../project-config.js'
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

/** Where a resolved `CURSOR_API_KEY` came from. */
export type CursorApiKeySource = 'process_environment' | 'dotenv'

/**
 * Presence-only report for one candidate `.env`. The credential value, any
 * part of it, and its length are deliberately absent: a doctor report is
 * operator-readable output that may be pasted into an issue or a chat.
 */
export interface CursorDotEnvInspection {
  /** Absolute path of the candidate file. */
  path: string
  exists: boolean
  /** False when the file could not be read or parsed, null when absent. */
  parsable: boolean | null
  /** Null when the file does not exist or could not be parsed. */
  declares_key: boolean | null
}

export interface CursorAuthenticationReadiness {
  /** Whether a spawned cursor-agent probe would carry a credential. */
  key_available: boolean
  source: CursorApiKeySource | null
  /** Absolute path of the `.env` that supplied the key, null otherwise. */
  source_path: string | null
  /** Every candidate `.env`, in the order `probeEnvironment` consults them. */
  dotenv_files: CursorDotEnvInspection[]
  advisories: string[]
}

interface DotEnvCandidate extends CursorDotEnvInspection {
  /** The resolved secret, kept only to build a child environment. */
  key: string | null
}

/**
 * Roots whose `.env` may carry the probe credential, in precedence order.
 *
 * The installation root comes first, because a credential placed beside the
 * harness configuration is unambiguously harness-scoped. The deliverable
 * workspace root follows: an embedded harness lives at `<target>/.pancreator`
 * and a detached harness lives outside the target entirely, so an operator who
 * keeps repository secrets at the target repository root would otherwise have
 * no discoverable location at all. The two coincide in a self-development
 * checkout, which then yields one candidate.
 */
function credentialSearchRoots(root: string): string[] {
  const installationRoot = path.resolve(root)
  let configuredWorkspace: string | undefined

  try {
    configuredWorkspace = readProjectConfig(root)?.workspace_root
  } catch {
    // A malformed harness configuration is `pan validate`'s to report. Probe
    // authentication still works from the installation root alone.
  }

  if (configuredWorkspace === undefined) {
    return [installationRoot]
  }

  const workspaceRoot = path.resolve(installationRoot, configuredWorkspace)

  return workspaceRoot === installationRoot
    ? [installationRoot]
    : [installationRoot, workspaceRoot]
}

function inspectDotEnv(filePath: string): DotEnvCandidate {
  if (!fileExists(filePath)) {
    return {
      path: filePath,
      exists: false,
      parsable: null,
      declares_key: null,
      key: null,
    }
  }

  let parsed: Record<string, string | undefined>

  try {
    parsed = parseEnv(readText(filePath))
  } catch {
    return {
      path: filePath,
      exists: true,
      parsable: false,
      declares_key: null,
      key: null,
    }
  }

  const declared = parsed.CURSOR_API_KEY
  const key =
    typeof declared === 'string' && declared.length > 0 ? declared : null

  return {
    path: filePath,
    exists: true,
    parsable: true,
    declares_key: key !== null,
    key,
  }
}

/**
 * The single resolution order shared by `probeEnvironment` and
 * `cursorAuthenticationReadiness`, so a readiness report can never describe a
 * path the probe itself does not read.
 */
function dotEnvCandidates(root: string): DotEnvCandidate[] {
  return credentialSearchRoots(root).map((searchRoot) =>
    inspectDotEnv(path.join(searchRoot, '.env')),
  )
}

function withoutSecret(candidate: DotEnvCandidate): CursorDotEnvInspection {
  return {
    path: candidate.path,
    exists: candidate.exists,
    parsable: candidate.parsable,
    declares_key: candidate.declares_key,
  }
}

/**
 * Environment for a spawned probe. When the parent process already carries
 * `CURSOR_API_KEY` it wins; otherwise a `.env` supplies it, so a probe
 * authenticates the same way ASK-001 expects an agent to recover a secret.
 * Only that one key crosses into the child, the parent environment is never
 * mutated, and the value is never logged or returned.
 */
export function probeEnvironment(root: string): NodeJS.ProcessEnv | undefined {
  const existing = process.env.CURSOR_API_KEY

  if (typeof existing === 'string' && existing.length > 0) {
    return undefined
  }

  const supplying = dotEnvCandidates(root).find(
    (candidate) => candidate.key !== null,
  )

  if (supplying === undefined || supplying.key === null) {
    return undefined
  }

  return { ...process.env, CURSOR_API_KEY: supplying.key }
}

/**
 * Report whether a Cursor model probe or a cursor-executor stage can
 * authenticate, without spawning anything.
 *
 * This is advisory. An interactive `cursor-agent login` authenticates the CLI
 * with no environment key at all, so an absent key is a readiness gap rather
 * than proof that a probe will fail.
 */
export function cursorAuthenticationReadiness(
  root: string,
): CursorAuthenticationReadiness {
  const processKey = process.env.CURSOR_API_KEY
  const fromProcess = typeof processKey === 'string' && processKey.length > 0
  const candidates = dotEnvCandidates(root)
  const supplying =
    candidates.find((candidate) => candidate.key !== null) ?? null
  const advisories: string[] = []
  let source: CursorApiKeySource | null = null
  let sourcePath: string | null = null

  if (fromProcess) {
    source = 'process_environment'
  } else if (supplying !== null) {
    source = 'dotenv'
    sourcePath = supplying.path
  }

  const readiness: CursorAuthenticationReadiness = {
    key_available: source !== null,
    source,
    source_path: sourcePath,
    dotenv_files: candidates.map((candidate) => withoutSecret(candidate)),
    advisories,
  }

  if (readiness.key_available) {
    return readiness
  }

  for (const candidate of candidates) {
    if (candidate.parsable === false) {
      advisories.push(
        `${candidate.path} exists but could not be read as an environment ` +
          'file, so a CURSOR_API_KEY declared there is ignored. Make it a ' +
          'readable file that node:util parseEnv accepts.',
      )
    } else if (candidate.exists) {
      advisories.push(
        `${candidate.path} exists but declares no non-empty CURSOR_API_KEY.`,
      )
    }
  }

  const searched = candidates.map((candidate) => candidate.path).join(' or ')

  if (candidates.every((candidate) => !candidate.exists)) {
    advisories.push(`No .env file exists at ${searched}.`)
  }

  advisories.push(
    'Cursor model probes and cursor-executor stages have no CURSOR_API_KEY ' +
      `to authenticate with. Add CURSOR_API_KEY=<key> to ${searched}, or run ` +
      'cursor-agent login; an interactive login authenticates the CLI without ' +
      'an environment key, so this is a readiness gap rather than a certain ' +
      'failure.',
  )

  return readiness
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
  env?: NodeJS.ProcessEnv,
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
      ...(env ? { env } : {}),
    },
  )

  if (result.error) {
    return {
      resolved: null,
      error: `cursor-agent could not run: ${result.error.message}. Probes need the cursor-agent CLI and CURSOR_API_KEY (from the process environment, the installation .env, or the workspace-root .env) or a cursor-agent login.`,
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

  const probes: CursorModelProbe[] = []

  for (const [spec, specPersonas] of [...bySpec.entries()].sort()) {
    const expected = expectedFor(catalog, spec)
    const { resolved, error } = probeCursorModelSpec(
      spec,
      PROBE_TIMEOUT_MS,
      env,
    )
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
