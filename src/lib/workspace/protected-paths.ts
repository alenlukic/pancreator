import path from 'node:path'

/**
 * Paths outside agent remit. These are third-party dependencies, virtual
 * environments, caches, generated output, and compiled artifacts. Pancreator
 * deliberately excludes them from workspace fingerprints and agents MUST NOT
 * read, edit, create, delete, or report them as implementation work.
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

export function normalizeProtectedPath(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).replace(/^\.\//u, '')
}

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

export const PROTECTED_PATH_RULE =
  'You MUST NOT read, edit, create, delete, index, validate, or report compiled artifacts, caches, virtual environments, or third-party dependency/package directories (including .venv, venv, .pyenv, site-packages, node_modules, vendor, dist, build, coverage, __pycache__, and tool caches). They are outside agent remit even when present or changed.'

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
