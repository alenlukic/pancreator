import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs'
import path from 'node:path'

import { gitTrackedWorkspacePaths, isGitRepository } from './git.js'
import { configuredWorkspaceRoot } from './project-config.js'

export interface DetectedTechnology {
  id: string
  evidence: string[]
}

export interface TechnologyDetection {
  languages: DetectedTechnology[]
  unsupported_evidence: string[]
}

interface TechnologyDefinition {
  id: string
  manifests: readonly string[]
  extensions: readonly string[]
}

const TECHNOLOGIES: readonly TechnologyDefinition[] = [
  {
    id: 'javascript',
    manifests: ['package.json'],
    extensions: ['.cjs', '.js', '.mjs'],
  },
  {
    id: 'python',
    manifests: [
      'Pipfile',
      'environment.yaml',
      'environment.yml',
      'noxfile.py',
      'pdm.lock',
      'poetry.lock',
      'pyproject.toml',
      'requirements.txt',
      'setup.cfg',
      'setup.py',
      'tox.ini',
      'uv.lock',
    ],
    extensions: ['.py', '.pyi'],
  },
  {
    id: 'typescript',
    manifests: ['tsconfig.json'],
    extensions: ['.ts', '.tsx'],
  },
]

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.mypy_cache',
  '.nox',
  '.pancreator',
  '.pytest_cache',
  '.ruff_cache',
  '.svn',
  '.tox',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
  'venv',
])
const MAX_DEPTH = 4
const MAX_ENTRIES = 10_000
const UNSUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.go',
  '.java',
  '.kt',
  '.php',
  '.rb',
  '.rs',
  '.swift',
])

function evidenceForManifest(root: string): Map<string, string[]> {
  const evidence = new Map<string, string[]>()

  for (const technology of TECHNOLOGIES) {
    for (const manifest of technology.manifests) {
      const manifestPath = path.join(root, manifest)

      try {
        if (
          readdirSync(path.dirname(manifestPath)).some(
            (name) => name === manifest,
          )
        ) {
          evidence.set(technology.id, [manifest])
          break
        }
      } catch {
        // A missing or unreadable workspace root is handled by source scanning.
      }
    }
  }

  return evidence
}

function scanSources(
  root: string,
  directory: string,
  depth: number,
  budget: { remaining: number },
  evidence: Map<string, string[]>,
  unsupportedEvidence: string[],
): void {
  if (depth > MAX_DEPTH || budget.remaining <= 0) {
    return
  }

  let entries: Dirent[]

  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    budget.remaining -= 1

    if (budget.remaining < 0) {
      return
    }

    const absolute = path.join(directory, entry.name)
    const relative = path.relative(root, absolute)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        scanSources(
          root,
          absolute,
          depth + 1,
          budget,
          evidence,
          unsupportedEvidence,
        )
      }
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const extension = path.extname(entry.name).toLowerCase()
    const technology = TECHNOLOGIES.find((item) =>
      item.extensions.includes(extension),
    )

    if (technology) {
      const values = evidence.get(technology.id) ?? []
      values.push(relative)
      evidence.set(technology.id, values)
    } else if (UNSUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
      unsupportedEvidence.push(relative)
    }
  }
}

function scanTrackedSources(
  root: string,
  evidence: Map<string, string[]>,
  unsupportedEvidence: string[],
): void {
  for (const relative of gitTrackedWorkspacePaths(root)) {
    const extension = path.extname(relative).toLowerCase()
    const technology = TECHNOLOGIES.find((item) =>
      item.extensions.includes(extension),
    )

    if (technology) {
      const values = evidence.get(technology.id) ?? []
      values.push(relative)
      evidence.set(technology.id, values)
    } else if (UNSUPPORTED_SOURCE_EXTENSIONS.has(extension)) {
      unsupportedEvidence.push(relative)
    }
  }
}

/**
 * Detects the supported languages of the workspace (the configured one by
 * default) from manifests and source file extensions, scanning tracked files
 * in a Git repository and a bounded directory walk otherwise. Returns each
 * language with its sorted evidence paths, plus source files of unsupported
 * languages.
 */
export function detectWorkspaceTechnologies(
  root: string,
  options: { workspace?: string } = {},
): TechnologyDetection {
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const evidence = evidenceForManifest(workspaceRoot)
  const unsupportedEvidence: string[] = []

  if (isGitRepository(workspaceRoot)) {
    scanTrackedSources(workspaceRoot, evidence, unsupportedEvidence)
  } else {
    scanSources(
      workspaceRoot,
      workspaceRoot,
      0,
      { remaining: MAX_ENTRIES },
      evidence,
      unsupportedEvidence,
    )
  }

  return {
    languages: [...evidence.entries()]
      .map(([id, values]) => ({ id, evidence: [...new Set(values)].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    unsupported_evidence: [...new Set(unsupportedEvidence)].sort(),
  }
}

/** Ids of every technology the harness supports. */
export function supportedTechnologyIds(): Set<string> {
  return new Set(TECHNOLOGIES.map((technology) => technology.id))
}

/**
 * Observability tools the target declares, detected from config files and
 * dependency manifests. The librarian names each detected tool and the query
 * that checks a signal in the primer's `## Observability` section, and a ship
 * observation in a target installation names that tool. Nothing in the
 * harness queries the tool.
 */
interface ObservabilityDefinition {
  id: string
  /** Basename patterns of the tool's own configuration files. */
  configFiles: readonly RegExp[]
  /** npm package names or scopes, matched against manifest dependency keys. */
  npmPackages: readonly RegExp[]
  /** Python distribution names, matched against Python manifest text. */
  pythonPackages: readonly RegExp[]
}

const OBSERVABILITY_TOOLS: readonly ObservabilityDefinition[] = [
  {
    id: 'datadog',
    configFiles: [/^datadog(?:-agent|-values)?\.ya?ml$/iu],
    npmPackages: [/^dd-trace$/u, /^@datadog\//u],
    pythonPackages: [/(?:^|[^\w-])(?:ddtrace|datadog)(?![\w-])/imu],
  },
  {
    id: 'opentelemetry',
    configFiles: [/^(?:otel|otelcol|opentelemetry)[\w.-]*\.ya?ml$/iu],
    npmPackages: [/^@opentelemetry\//u],
    pythonPackages: [/(?:^|[^\w-])opentelemetry-[a-z0-9_-]+/imu],
  },
  {
    id: 'sentry',
    configFiles: [
      /^sentry\.properties$/u,
      /^\.sentryclirc$/u,
      /^sentry\.[\w-]+\.config\.(?:c|m)?[jt]s$/u,
    ],
    npmPackages: [/^@sentry\//u],
    pythonPackages: [/(?:^|[^\w-])sentry[-_]sdk(?![\w-])/imu],
  },
]

const PYTHON_MANIFESTS = [
  /^requirements[\w.-]*\.txt$/u,
  /^pyproject\.toml$/u,
  /^Pipfile$/u,
]
const MAX_MANIFEST_BYTES = 1_000_000

function walkWorkspaceFiles(
  root: string,
  directory: string,
  depth: number,
  budget: { remaining: number },
  files: string[],
): void {
  if (depth > MAX_DEPTH || budget.remaining <= 0) {
    return
  }

  let entries: Dirent[]

  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    budget.remaining -= 1

    if (budget.remaining < 0) {
      return
    }

    const absolute = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        walkWorkspaceFiles(root, absolute, depth + 1, budget, files)
      }
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolute))
    }
  }
}

function manifestText(workspaceRoot: string, relative: string): string | null {
  const absolute = path.join(workspaceRoot, relative)

  try {
    return statSync(absolute).size > MAX_MANIFEST_BYTES
      ? null
      : readFileSync(absolute, 'utf8')
  } catch {
    return null
  }
}

function npmDependencyNames(text: string): string[] {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return []
  }

  const manifest = parsed as Record<string, unknown>

  return [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ].flatMap((key) => {
    const block = manifest[key]

    return typeof block === 'object' && block !== null && !Array.isArray(block)
      ? Object.keys(block)
      : []
  })
}

/**
 * Detect Sentry, Datadog, and OpenTelemetry from Git-tracked files, or from a
 * bounded walk when the workspace is not a Git repository, with the paths
 * that evidence each tool.
 */
export function detectObservabilityTools(
  root: string,
  options: { workspace?: string } = {},
): DetectedTechnology[] {
  const workspaceRoot = path.resolve(
    root,
    options.workspace ?? configuredWorkspaceRoot(root),
  )
  const files: string[] = []

  if (isGitRepository(workspaceRoot)) {
    files.push(...gitTrackedWorkspacePaths(workspaceRoot))
  } else {
    walkWorkspaceFiles(
      workspaceRoot,
      workspaceRoot,
      0,
      { remaining: MAX_ENTRIES },
      files,
    )
  }

  const evidence = new Map<string, Set<string>>()
  const record = (id: string, relative: string): void => {
    const values = evidence.get(id) ?? new Set<string>()
    values.add(relative)
    evidence.set(id, values)
  }

  for (const relative of files) {
    const basename = path.basename(relative)

    for (const tool of OBSERVABILITY_TOOLS) {
      if (tool.configFiles.some((pattern) => pattern.test(basename))) {
        record(tool.id, relative)
      }
    }

    if (basename === 'package.json') {
      const text = manifestText(workspaceRoot, relative)
      const names = text === null ? [] : npmDependencyNames(text)

      for (const tool of OBSERVABILITY_TOOLS) {
        if (
          names.some((name) =>
            tool.npmPackages.some((pattern) => pattern.test(name)),
          )
        ) {
          record(tool.id, relative)
        }
      }
    } else if (PYTHON_MANIFESTS.some((pattern) => pattern.test(basename))) {
      const text = manifestText(workspaceRoot, relative)

      for (const tool of OBSERVABILITY_TOOLS) {
        if (
          text !== null &&
          tool.pythonPackages.some((pattern) => pattern.test(text))
        ) {
          record(tool.id, relative)
        }
      }
    }
  }

  return [...evidence.entries()]
    .map(([id, values]) => ({ id, evidence: [...values].sort() }))
    .sort((left, right) => left.id.localeCompare(right.id))
}
