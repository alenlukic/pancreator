/** Snapshot compression, the spend token, and the bounded service fetch. */

import { createGunzip, createGzip } from 'node:zlib'
import path from 'node:path'
import { parseEnv } from 'node:util'

import { credentialRoots } from '../cursor-usage.js'
import { invariant } from '../errors.js'
import { fileExists, readText } from '../io.js'
import { isLoopbackHostname } from '../project-config.js'

const SYNC_TIMEOUT_MS = 60_000

export function gzipJson(value: unknown): Promise<Buffer> {
  const json = JSON.stringify(value)
  const input = Buffer.from(json, 'utf8')
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGzip()

    gz.on('data', (chunk: Buffer) => chunks.push(chunk))
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(input)
  })
}

export function gunzipBuffer(compressed: Buffer): Promise<Buffer> {
  const chunks: Buffer[] = []

  return new Promise<Buffer>((resolve, reject) => {
    const gz = createGunzip()

    gz.on('data', (chunk: Buffer) => chunks.push(chunk))
    gz.on('end', () => resolve(Buffer.concat(chunks)))
    gz.on('error', reject)
    gz.end(compressed)
  })
}

/**
 * Resolve `PAN_SPEND_SYNC_TOKEN` from the process environment or `.env` files.
 * Uses the same root search as Cursor usage credentials.
 */
export function resolveSpendToken(root: string): string {
  const envToken = process.env.PAN_SPEND_SYNC_TOKEN

  if (typeof envToken === 'string' && envToken.length > 0) {
    return envToken
  }

  for (const candidateRoot of credentialRoots(root)) {
    const envPath = path.join(candidateRoot, '.env')

    if (!fileExists(envPath)) {
      continue
    }

    try {
      const parsed = parseEnv(readText(envPath))
      const token = parsed.PAN_SPEND_SYNC_TOKEN

      if (typeof token === 'string' && token.length > 0) {
        return token
      }
    } catch {
      continue
    }
  }

  invariant(
    false,
    'PAN_SPEND_SYNC_TOKEN is not set in the environment or any .env file.',
    { code: 'SPEND_SYNC_TOKEN_MISSING' },
  )
}

/** Validate a URL: must be https, or http for loopback only (C-9). */
export function assertSecureUrl(url: string, context: string): void {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    invariant(false, `${context} is not a valid URL: ${url}`, {
      code: 'SPEND_SYNC_INVALID_RESPONSE',
    })
  }

  invariant(
    parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)),
    `${context} must use https (or http for a loopback host), got: ${url}`,
    { code: 'SPEND_SYNC_INVALID_RESPONSE' },
  )
}

export async function timedFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return fetchImpl(url, {
    ...init,
    signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
  })
}

export async function expectJson(
  response: Response,
  context: string,
): Promise<unknown> {
  if (response.status === 401 || response.status === 403) {
    invariant(false, `${context}: unauthorized (${response.status}).`, {
      code: 'SPEND_SYNC_UNAUTHORIZED',
    })
  }

  if (!response.ok) {
    invariant(
      false,
      `${context}: request failed with status ${response.status}.`,
      {
        code: 'SPEND_SYNC_REQUEST_FAILED',
      },
    )
  }

  try {
    return (await response.json()) as unknown
  } catch {
    invariant(false, `${context}: response is not valid JSON.`, {
      code: 'SPEND_SYNC_INVALID_RESPONSE',
    })
  }
}

export function readVersion(root: string): string {
  const versionPath = path.join(root, 'VERSION')

  return fileExists(versionPath) ? readText(versionPath).trim() : 'unknown'
}
