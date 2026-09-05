import path from 'node:path'
import { parseEnv } from 'node:util'

import { fileExists, readText } from '../io.js'
import { readProjectConfig } from '../project-config.js'

// Credential resolution for every spawned cursor-agent process: the model
// probe, the away evaluator, the hypervisor, and external-executor stages.
// It lives apart from cursor-probe.ts so cursor-agent.ts can import it
// without a cycle.

export type CursorApiKeySource = 'process_environment' | 'dotenv'

/**
 * Presence-only report for one candidate `.env`. It must never carry the
 * credential value or its length, because operators paste doctor output.
 */
export interface CursorDotEnvInspection {
  /** Absolute path of the candidate file. */
  path: string
  exists: boolean
  /** False when the file cannot be read or parsed, null when it is absent. */
  parsable: boolean | null
  /** Null when the file does not exist or cannot be parsed. */
  declares_key: boolean | null
}

export interface CursorAuthenticationReadiness {
  /** True when a spawned cursor-agent probe carries a credential. */
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
 * Roots whose `.env` can carry the probe credential, in precedence order: the
 * installation root first, then the workspace root.
 */
function credentialSearchRoots(root: string): string[] {
  const installationRoot = path.resolve(root)
  let configuredWorkspace: string | undefined

  try {
    configuredWorkspace = readProjectConfig(root)?.workspace_root
  } catch {
    // `pan validate` reports a malformed configuration. The probe still
    // authenticates from the installation root alone.
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
 * The one resolution order that `probeEnvironment` and
 * `cursorAuthenticationReadiness` share, so a readiness report never names a
 * path the probe skips.
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
 * Build the environment for a spawned probe. A parent `CURSOR_API_KEY` wins,
 * otherwise a `.env` supplies it, as ASK-001 expects. Only that one key
 * crosses into the child. The harness never changes the parent environment and
 * never logs or returns the value.
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
 * authenticate. This starts no process. An absent key is a readiness gap,
 * not a certain failure, because `cursor-agent login` authenticates the CLI
 * without one.
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
