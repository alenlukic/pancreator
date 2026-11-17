import path from 'node:path'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { invariant } from './errors.js'
import { isRecord, resolveInside, sha256 } from './io.js'

/** Require an actual nonempty workspace file, never a directory or link. */
export function traceArtifactPath(workspace: string, relative: string): string {
  invariant(
    relative.trim() === relative &&
      relative.length > 0 &&
      !path.isAbsolute(relative) &&
      !relative.includes('\\') &&
      path.posix.normalize(relative) === relative &&
      !relative
        .split('/')
        .some(
          (part) =>
            part === '..' ||
            part === '.git' ||
            part === 'node_modules' ||
            part === 'runtime',
        ),
    `Trace artifact must be a repository-relative path: ${relative}`,
  )
  const absolute = resolveInside(workspace, relative)
  const stat = lstatSync(absolute)
  invariant(
    stat.isFile() &&
      stat.size > 0 &&
      realpathSync(absolute) ===
        path.resolve(realpathSync(workspace), relative),
    `Trace artifact must be a nonempty regular file: ${relative}`,
  )
  return absolute
}

/** Deduplicate paths: several scenarios can intentionally share a test file. */
export function traceArtifactPaths(
  data: Record<string, unknown>,
  key: 'skeletons' | 'trace_tests',
): string[] {
  const entries = data[key]
  invariant(
    Array.isArray(entries) && entries.length > 0,
    `Missing trace ${key}`,
  )
  return [
    ...new Set(
      entries.map((entry: unknown) => {
        invariant(
          isRecord(entry) && typeof entry.path === 'string',
          `Missing ${key} path`,
        )
        return entry.path
      }),
    ),
  ].sort()
}

export function traceArtifactDigests(
  workspace: string,
  data: Record<string, unknown>,
): Array<{ path: string; sha256: string }> {
  const paths = [
    ...new Set([
      ...traceArtifactPaths(data, 'skeletons'),
      ...traceArtifactPaths(data, 'trace_tests'),
      ...(isRecord(data.interface_schema) &&
      typeof data.interface_schema.path === 'string'
        ? [data.interface_schema.path]
        : []),
    ]),
  ].sort()
  return paths.map((relative) => ({
    path: relative,
    sha256: sha256(readFileSync(traceArtifactPath(workspace, relative))),
  }))
}
