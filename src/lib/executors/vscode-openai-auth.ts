import { spawnSync } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { closeSync, openSync, readSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

import { isRecord } from '../io.js'

const MAX_BYTES = 1024 * 1024
const COMMAND_TIMEOUT_MS = 15_000

/** Injectable local boundaries; command results can contain secrets. */
export interface VsCodeSecretStorageAccess {
  platform: string
  home: string
  read: (file: string) => string
  run: (binary: string, args: string[]) => string | null
}

function readBounded(file: string): string {
  const descriptor = openSync(file, 'r')

  try {
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    const size = readSync(descriptor, buffer, 0, buffer.length, 0)

    if (size > MAX_BYTES) {
      throw new Error('Unsupported VS Code storage size')
    }

    return buffer.subarray(0, size).toString('utf8')
  } finally {
    closeSync(descriptor)
  }
}

function runBounded(binary: string, args: string[]): string | null {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_BYTES,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return result.status === 0 && !result.error ? result.stdout : null
}

/**
 * Read only stable VS Code's macOS OpenAI secret. Callers must establish explicit
 * opt-in before calling. All storage, Keychain, and crypto failures stay local;
 * neither raw command errors nor credential material belong in diagnostics.
 */
export function resolveVsCodeOpenAiKey(
  access: VsCodeSecretStorageAccess = {
    platform: process.platform,
    home: homedir(),
    read: readBounded,
    run: runBounded,
  },
): { key: string; sourcePath: string } | null {
  if (access.platform !== 'darwin') {
    return null
  }

  try {
    const userRoot = path.join(
      access.home,
      'Library',
      'Application Support',
      'Code',
      'User',
    )
    const sourcePath = path.join(userRoot, 'chatLanguageModels.json')
    const text = access.read(sourcePath)

    if (Buffer.byteLength(text) > MAX_BYTES) {
      return null
    }

    const configurations: unknown = JSON.parse(text)

    if (!Array.isArray(configurations)) {
      return null
    }

    const openai = configurations.filter(
      (entry: unknown) => isRecord(entry) && entry.vendor === 'openai',
    )

    if (openai.length !== 1) {
      return null
    }

    const configuration: unknown = openai[0]
    const reference = isRecord(configuration) ? configuration.apiKey : null
    const match =
      typeof reference === 'string'
        ? /^\$\{input:(chat\.lm\.secret\.-?[A-Za-z0-9_-]{1,128})\}$/u.exec(
            reference,
          )
        : null

    if (!match?.[1]) {
      return null
    }

    // The validated reference cannot contain SQL quotes or path components.
    const stored = access.run('/usr/bin/sqlite3', [
      '-readonly',
      '-noheader',
      path.join(userRoot, 'globalStorage', 'state.vscdb'),
      `SELECT value FROM ItemTable WHERE key = 'secret://${match[1]}';`,
    ])

    if (stored === null || Buffer.byteLength(stored) > MAX_BYTES) {
      return null
    }

    const envelope: unknown = JSON.parse(stored)

    if (
      !isRecord(envelope) ||
      envelope.type !== 'Buffer' ||
      !Array.isArray(envelope.data) ||
      envelope.data.length > MAX_BYTES ||
      !envelope.data.every(
        (byte: unknown) =>
          typeof byte === 'number' &&
          Number.isInteger(byte) &&
          byte >= 0 &&
          byte <= 255,
      )
    ) {
      return null
    }

    const ciphertext = Buffer.from(envelope.data as number[])

    if (
      ciphertext.subarray(0, 3).toString('ascii') !== 'v10' ||
      ciphertext.length <= 3 ||
      (ciphertext.length - 3) % 16 !== 0
    ) {
      return null
    }

    const password = access.run('/usr/bin/security', [
      'find-generic-password',
      '-s',
      'Code Safe Storage',
      '-w',
    ])

    if (password === null || Buffer.byteLength(password) > MAX_BYTES) {
      return null
    }

    const key = pbkdf2Sync(
      password.replace(/\n$/u, ''),
      'saltysalt',
      1003,
      16,
      'sha1',
    )
    let plaintext: Buffer | undefined

    try {
      const decipher = createDecipheriv(
        'aes-128-cbc',
        key,
        Buffer.alloc(16, 32),
      )

      plaintext = Buffer.concat([
        decipher.update(ciphertext.subarray(3)),
        decipher.final(),
      ])
      const decoded = plaintext.toString('utf8')
      const secret: unknown = decoded.startsWith('sk-')
        ? decoded
        : JSON.parse(decoded)

      return typeof secret === 'string' &&
        secret.length > 0 &&
        !/[\s\u0000-\u001f\u007f]/u.test(secret)
        ? { key: secret, sourcePath }
        : null
    } finally {
      key.fill(0)
      plaintext?.fill(0)
    }
  } catch {
    return null
  }
}
