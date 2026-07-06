import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import { errorMessage, invariant, isNodeError, PanError } from './errors.js'

function isPathWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)

  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  )
}

function resolveCanonicalBoundaryPath(targetPath: string): string {
  if (fileExists(targetPath)) {
    return canonicalize(targetPath)
  }

  let ancestor = targetPath

  while (!fileExists(ancestor)) {
    const parent = path.dirname(ancestor)

    invariant(parent !== ancestor, 'Path escapes repository root.', {
      code: 'PATH_ESCAPE',
    })
    ancestor = parent
  }

  const canonicalAncestor = canonicalize(ancestor)
  const remainder = path.relative(ancestor, targetPath)

  return path.resolve(canonicalAncestor, remainder)
}

export function findProjectRoot(start = process.cwd()): string {
  let current = path.resolve(start)

  while (true) {
    const packagePath = path.join(current, 'package.json')

    if (existsSync(packagePath)) {
      try {
        const packageValue: unknown = JSON.parse(
          readFileSync(packagePath, 'utf8'),
        )

        if (
          isRecord(packageValue) &&
          packageValue.name === 'pancreator-v2-prototype'
        ) {
          return current
        }
      } catch {
        // Validation reports malformed package files after root discovery.
      }
    }

    const parent = path.dirname(current)

    if (parent === current) {
      throw new PanError('Could not locate the Pancreator repository root.', {
        code: 'ROOT_NOT_FOUND',
        details: { start },
      })
    }

    current = parent
  }
}

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true })
}

export function readJson(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown
  } catch (error) {
    throw new PanError(`Failed to read JSON: ${filePath}`, {
      code: 'INVALID_JSON',
      details: { cause: errorMessage(error) },
    })
  }
}

export function readText(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8')
  } catch (error) {
    throw new PanError(`Failed to read file: ${filePath}`, {
      code: 'READ_FAILED',
      details: { cause: errorMessage(error) },
    })
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

export function writeTextAtomic(filePath: string, value: string): void {
  ensureDir(path.dirname(filePath))

  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tempPath, value.endsWith('\n') ? value : `${value}\n`, 'utf8')
  renameSync(tempPath, filePath)
}

export function appendJsonLine(filePath: string, value: unknown): void {
  ensureDir(path.dirname(filePath))
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8')
}

export function sha256(value: unknown): string {
  const input =
    typeof value === 'string' || value instanceof Uint8Array
      ? value
      : stableStringify(value)

  return createHash('sha256').update(input).digest('hex')
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value) ?? 'undefined'
}

export function toRepoRelative(
  root: string,
  absoluteOrRelativePath: string,
): string {
  const canonicalRoot = canonicalize(root)
  const absolute = path.isAbsolute(absoluteOrRelativePath)
    ? path.resolve(absoluteOrRelativePath)
    : path.resolve(canonicalRoot, absoluteOrRelativePath)
  const boundaryPath = resolveCanonicalBoundaryPath(absolute)

  invariant(
    isPathWithinRoot(canonicalRoot, boundaryPath),
    `Path must remain inside the repository: ${absoluteOrRelativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  const relative = path.relative(canonicalRoot, absolute)

  invariant(
    relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative),
    `Path must remain inside the repository: ${absoluteOrRelativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  return relative.split(path.sep).join('/')
}

export function resolveInside(root: string, relativePath: string): string {
  const canonicalRoot = canonicalize(root)

  invariant(
    relativePath.length > 0,
    'Expected a non-empty repository-relative path.',
    { code: 'INVALID_PATH' },
  )

  const absolute = path.resolve(canonicalRoot, relativePath)
  const relative = path.relative(canonicalRoot, absolute)

  invariant(
    !relative.startsWith('..') && !path.isAbsolute(relative),
    `Path escapes repository root: ${relativePath}`,
    { code: 'PATH_ESCAPE' },
  )
  invariant(
    isPathWithinRoot(canonicalRoot, resolveCanonicalBoundaryPath(absolute)),
    `Path escapes repository root: ${relativePath}`,
    { code: 'PATH_ESCAPE' },
  )

  return absolute
}

export function canonicalize(filePath: string): string {
  const resolved = path.resolve(filePath)

  try {
    return realpathSync.native(resolved)
  } catch (error) {
    throw new PanError(`Failed to canonicalize path: ${filePath}`, {
      code: 'PATH_NOT_FOUND',
      details: { cause: errorMessage(error) },
    })
  }
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isNodeError(error) && error.code === 'EPERM'
  }
}

export function clearStaleOperationMutex(mutexPath: string): boolean {
  if (!existsSync(mutexPath)) {
    return false
  }

  let owner = Number.NaN

  try {
    owner = Number(readFileSync(mutexPath, 'utf8').trim())
  } catch {
    // A malformed mutex is stale.
  }

  if (processIsAlive(owner)) {
    return false
  }

  rmSync(mutexPath, { force: true })
  return true
}

export function withOperationMutex<T>(mutexPath: string, callback: () => T): T {
  ensureDir(path.dirname(mutexPath))

  let descriptor: number | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      descriptor = openSync(mutexPath, 'wx')
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8')
      break
    } catch (error) {
      if (attempt === 0 && clearStaleOperationMutex(mutexPath)) {
        continue
      }

      let owner = Number.NaN

      try {
        owner = Number(readFileSync(mutexPath, 'utf8').trim())
      } catch {
        // Preserve NaN in diagnostics for an unreadable live mutex.
      }

      throw new PanError(
        `Another Pancreator command is updating this run: ${mutexPath}`,
        {
          code: 'RUN_OPERATION_IN_PROGRESS',
          details: { owner_pid: owner, cause: errorMessage(error) },
        },
      )
    }
  }

  invariant(
    descriptor !== undefined,
    `Failed to serialize run operation: ${mutexPath}`,
    { code: 'RUN_OPERATION_SERIALIZATION_FAILED' },
  )

  try {
    return callback()
  } finally {
    try {
      closeSync(descriptor)
    } finally {
      rmSync(mutexPath, { force: true })
    }
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath)
}

export function isFile(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isFile()
}

export function isDirectory(filePath: string): boolean {
  return existsSync(filePath) && statSync(filePath).isDirectory()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
