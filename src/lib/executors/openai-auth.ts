import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { fileExists, readText } from '../io.js'

const GIT_TIMEOUT_MS = 5_000
const OPENAI_API_KEY = 'OPENAI_API_KEY'

export type OpenAiApiKeySource = 'process_environment' | 'dotenv'

/** Presence-only report that never carries the credential value or length. */
export interface OpenAiDotEnvInspection {
  path: string
  exists: boolean
  parsable: boolean | null
  declares_key: boolean | null
}

export interface OpenAiAuthenticationReadiness {
  key_available: boolean
  source: OpenAiApiKeySource | null
  source_path: string | null
  dotenv_files: OpenAiDotEnvInspection[]
  advisories: string[]
}

interface DotEnvCandidate extends OpenAiDotEnvInspection {
  key: string | null
}

export interface ResolvedOpenAiApiKey {
  key: string | null
  source: OpenAiApiKeySource | null
  sourcePath: string | null
}

function gitCredentialRoots(cwd: string): string[] {
  const result = spawnSync(
    'git',
    [
      'rev-parse',
      '--path-format=absolute',
      '--show-toplevel',
      '--git-common-dir',
    ],
    {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    },
  )

  if (result.status !== 0 || typeof result.stdout !== 'string') {
    return []
  }

  const [worktreeRoot, commonDir] = result.stdout
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  return [
    ...(worktreeRoot ? [worktreeRoot] : []),
    ...(commonDir ? [path.dirname(commonDir)] : []),
  ]
}

/**
 * Candidate roots in precedence order: the caller's directory, its Git
 * worktree root, then the main checkout that owns the shared Git directory.
 */
function credentialSearchRoots(cwd: string): string[] {
  return [
    ...new Set([path.resolve(cwd), ...gitCredentialRoots(path.resolve(cwd))]),
  ]
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

  const declared = parsed[OPENAI_API_KEY]
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

function candidatesFor(cwd: string): DotEnvCandidate[] {
  return credentialSearchRoots(cwd).map((root) =>
    inspectDotEnv(path.join(root, '.env')),
  )
}

function withoutSecret(candidate: DotEnvCandidate): OpenAiDotEnvInspection {
  return {
    path: candidate.path,
    exists: candidate.exists,
    parsable: candidate.parsable,
    declares_key: candidate.declares_key,
  }
}

/** Resolve the process key first, then the first repository-local `.env`. */
export function resolveOpenAiApiKey(cwd: string): ResolvedOpenAiApiKey {
  const processKey = process.env[OPENAI_API_KEY]

  if (typeof processKey === 'string' && processKey.length > 0) {
    return {
      key: processKey,
      source: 'process_environment',
      sourcePath: null,
    }
  }

  const supplying = candidatesFor(cwd).find(
    (candidate) => candidate.key !== null,
  )

  if (!supplying || supplying.key === null) {
    return { key: null, source: null, sourcePath: null }
  }

  return {
    key: supplying.key,
    source: 'dotenv',
    sourcePath: supplying.path,
  }
}

/** Report authentication readiness without exposing the API key. */
export function openAiAuthenticationReadiness(
  cwd: string,
): OpenAiAuthenticationReadiness {
  const candidates = candidatesFor(cwd)
  const processKey = process.env[OPENAI_API_KEY]
  const fromProcess = typeof processKey === 'string' && processKey.length > 0
  const supplying = candidates.find((candidate) => candidate.key !== null)
  const source = fromProcess
    ? 'process_environment'
    : supplying
      ? 'dotenv'
      : null
  const advisories: string[] = []

  if (source === null) {
    for (const candidate of candidates) {
      if (candidate.parsable === false) {
        advisories.push(
          `${candidate.path} exists but could not be read as an environment file, so an ${OPENAI_API_KEY} declared there is ignored.`,
        )
      } else if (candidate.exists) {
        advisories.push(
          `${candidate.path} exists but declares no non-empty ${OPENAI_API_KEY}.`,
        )
      }
    }

    if (candidates.every((candidate) => !candidate.exists)) {
      advisories.push(
        `No .env file exists at ${candidates.map((candidate) => candidate.path).join(' or ')}.`,
      )
    }

    advisories.push(
      `No ${OPENAI_API_KEY} is available. Export it, or add ${OPENAI_API_KEY}=<key> to one of the inspected .env files.`,
    )
  }

  return {
    key_available: source !== null,
    source,
    source_path: fromProcess ? null : (supplying?.path ?? null),
    dotenv_files: candidates.map(withoutSecret),
    advisories,
  }
}
