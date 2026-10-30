import path from 'node:path'

/**
 * Paths outside agent remit. These are third-party dependencies, virtual
 * environments, caches, generated output, and compiled artifacts. Pancreator
 * deliberately excludes them from workspace fingerprints. Agents MUST NOT
 * edit, create, or delete them, and MAY read them when the task needs it.
 */
const PROTECTED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.eggs',
  '.mypy_cache',
  '.next',
  '.nuxt',
  '.parcel-cache',
  '.pnpm-store',
  '.pyenv',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  '.yarn',
  '__pycache__',
  'bower_components',
  'build',
  'coverage',
  'DerivedData',
  'dist',
  'htmlcov',
  'node_modules',
  'Pods',
  'site-packages',
  'target',
  'vendor',
  'venv',
])

const PROTECTED_DIRECTORY_SUFFIXES = ['.dist-info', '.egg-info'] as const

const PROTECTED_FILE_SUFFIXES = [
  '.a',
  '.class',
  '.dll',
  '.dylib',
  '.egg-info',
  '.jar',
  '.lib',
  '.o',
  '.obj',
  '.pdb',
  '.pyc',
  '.pyo',
  '.so',
  '.tsbuildinfo',
  '.wasm',
  '.whl',
] as const

/** Slash-separated, normalized form of a path with any leading `./` removed. */
export function normalizeProtectedPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//u, '')
}

/**
 * True when a path lies in or is a compiled artifact, cache, virtual
 * environment, or dependency directory, or has a compiled-file suffix: the
 * paths agents must not change.
 */
export function isProtectedWorkspacePath(value: string): boolean {
  const normalized = normalizeProtectedPath(value)
  const segments = normalized.split('/').filter(Boolean)

  if (
    segments.some(
      (segment) =>
        PROTECTED_DIRECTORY_NAMES.has(segment) ||
        PROTECTED_DIRECTORY_SUFFIXES.some((suffix) => segment.endsWith(suffix)),
    )
  ) {
    return true
  }

  return PROTECTED_FILE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
}

/** Card-boundary text: forbid mutating protected trees; allow a task-driven read. */
export const PROTECTED_PATH_RULE =
  'You MUST NOT edit, create, or delete compiled artifacts, caches, virtual environments, or third-party dependency/package directories (including .venv, venv, .pyenv, site-packages, node_modules, vendor, dist, build, coverage, __pycache__, and tool caches). You MAY read them when the task needs it or a debugging hypothesis points there.'

/** Git exclude pathspecs that drop every protected directory and compiled-file suffix from a Git command. */
export function protectedGitPathspecs(): string[] {
  const directories = [...PROTECTED_DIRECTORY_NAMES].map(
    (name) => `:(exclude,glob)**/${name}/**`,
  )
  const suffixedDirectories = PROTECTED_DIRECTORY_SUFFIXES.map(
    (suffix) => `:(exclude,glob)**/*${suffix}/**`,
  )
  const files = PROTECTED_FILE_SUFFIXES.map(
    (suffix) => `:(exclude,glob)**/*${suffix}`,
  )

  return [...directories, ...suffixedDirectories, ...files]
}
