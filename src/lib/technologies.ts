import { readdirSync, type Dirent } from 'node:fs'
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

export function detectWorkspaceTechnologies(root: string): TechnologyDetection {
  const workspaceRoot = path.resolve(root, configuredWorkspaceRoot(root))
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

export function supportedTechnologyIds(): Set<string> {
  return new Set(TECHNOLOGIES.map((technology) => technology.id))
}
