import path from 'node:path'

import { PanError } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  sha256,
  writeJsonAtomic,
} from './io.js'
import {
  gitChangedPathsBetween,
  gitHead,
  gitRevParse,
  gitStatusPaths,
  gitTrackedWorkspacePaths,
} from './git.js'
import { detectWorkspaceTechnologies } from './technologies.js'
import { isProtectedWorkspacePath } from './workspace/protected-paths.js'
import {
  codeStyleLanguage,
  validateCodeStyle,
  type CodeStyleLanguage,
} from './validators/code-style.js'
import type { HandlerInput, HandlerResult } from './requirements/types.js'

export const STYLE_CACHE_RELATIVE_PATH = 'runtime/cache/style.json'

export interface StyleCheckpointFileEntry {
  path: string
  sha256: string
  editable: boolean
}

export interface StyleCheckpointFile {
  schema_version: 1
  head: string
  checked_at: string
  files: Record<string, StyleCheckpointFileEntry>
}

export interface StyleScanOptions {
  workspace_root: string
  since_ref?: string | null
  all?: boolean
}

export interface StyleScanFile {
  relative_path: string
  language: CodeStyleLanguage
  absolute_path: string
  editable: boolean
  exists: boolean
  status: 'unchanged' | 'changed' | 'deleted'
  sha256: string | null
  checkpoint_sha256: string | null
  issues: HandlerResult['issues']
}

export interface StyleScanSummary {
  files: number
  editable_files: number
  report_only_files: number
  deleted_files: number
  issue_files: number
  editable_issue_files: number
  report_only_issue_files: number
}

export interface StyleScanResult {
  schema_version: 1
  status: 'passed' | 'failed'
  checked_at: string
  workspace_root: string
  head: string
  base: string
  languages: string[]
  checkpoint_path: string
  checkpoint_head: string | null
  files: StyleScanFile[]
  summary: StyleScanSummary
}

export interface StyleCheckpointResult {
  schema_version: 1
  status: 'passed' | 'blocked'
  checked_at: string
  workspace_root: string
  head: string
  languages: string[]
  checkpoint_path: string
  wrote_checkpoint: boolean
  files: StyleScanFile[]
  summary: StyleScanSummary & { checkpoint_entries: number }
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

/**
 * The harness subtree, when it sits inside the governed workspace. An embedded
 * installation lives at `<target>/.pancreator`, and those files are harness
 * source rather than target source, so the style mode reports them and never
 * edits them. Self-development and a detached installation produce no prefix:
 * the workspace either is the harness or holds none of it.
 */
function nestedHarnessPrefix(
  harnessRoot: string,
  workspaceRoot: string,
): string | null {
  const relative = path.relative(workspaceRoot, harnessRoot)

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null
  }

  return `${toPosix(relative)}/`
}

function isEditable(
  relativePath: string,
  harnessPrefix: string | null,
): boolean {
  return harnessPrefix === null || !relativePath.startsWith(harnessPrefix)
}

/**
 * A candidate is eligible when a detected workspace language owns its
 * extension. `gitTrackedWorkspacePaths` already drops protected and runtime
 * paths, but a changed-path selection also reports untracked and deleted
 * files, so the predicate repeats those exclusions.
 */
function isEligiblePath(
  relativePath: string,
  languages: ReadonlySet<string>,
): boolean {
  const relative = toPosix(relativePath)
  const language = codeStyleLanguage(relative)

  return (
    language !== null &&
    languages.has(language) &&
    !relative.startsWith('runtime/') &&
    !isProtectedWorkspacePath(relative)
  )
}

function detectedLanguages(
  harnessRoot: string,
  workspaceRoot: string,
): string[] {
  return detectWorkspaceTechnologies(harnessRoot, {
    workspace: workspaceRoot,
  }).languages.map((language) => language.id)
}

function loadCheckpoint(harnessRoot: string): StyleCheckpointFile | null {
  const absolute = path.join(harnessRoot, STYLE_CACHE_RELATIVE_PATH)

  if (!fileExists(absolute)) {
    return null
  }

  try {
    const value = readJson(absolute)

    if (
      !isRecord(value) ||
      value.schema_version !== 1 ||
      typeof value.head !== 'string' ||
      typeof value.checked_at !== 'string' ||
      !isRecord(value.files)
    ) {
      return null
    }

    const files: Record<string, StyleCheckpointFileEntry> = {}

    for (const [key, entry] of Object.entries(value.files)) {
      if (
        !isRecord(entry) ||
        typeof entry.path !== 'string' ||
        typeof entry.sha256 !== 'string' ||
        typeof entry.editable !== 'boolean'
      ) {
        continue
      }

      files[key] = {
        path: entry.path,
        sha256: entry.sha256,
        editable: entry.editable,
      }
    }

    return {
      schema_version: 1,
      head: value.head,
      checked_at: value.checked_at,
      files,
    }
  } catch {
    // This checkpoint is local derived state. A corrupt checkpoint is treated
    // as missing rather than as a hard failure.
    return null
  }
}

function resolveSinceBase(workspaceRoot: string, sinceRef: string): string {
  try {
    return gitRevParse(workspaceRoot, sinceRef)
  } catch (error) {
    if (error instanceof PanError) {
      throw new PanError(`--since ref is not a valid commit: ${sinceRef}`, {
        code: 'INVALID_ARGUMENT',
        details: { cause: error.message, since_ref: sinceRef },
      })
    }

    throw error
  }
}

function assertSelection(options: StyleScanOptions): void {
  if (options.since_ref && options.all) {
    throw new PanError('--since and --all cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }
}

function styleIssues(
  workspaceRoot: string,
  relativePath: string,
): HandlerResult['issues'] {
  const input: HandlerInput = {
    root: workspaceRoot,
    targetPath: relativePath,
    requirement: {
      policy_id: 'TSTYLE-001',
      requirement_id: 'standalone-style-code-style-validate',
      registry_id: 'CODE-STYLE-VALIDATE-001',
      arguments: {},
    },
  }

  return validateCodeStyle(input).issues
}

function scanFile(
  workspaceRoot: string,
  checkpoint: StyleCheckpointFile | null,
  harnessPrefix: string | null,
  relativePath: string,
): StyleScanFile {
  const relative = toPosix(relativePath)
  const language = codeStyleLanguage(relative)

  if (!language) {
    throw new PanError(`No style handbook covers ${relative}.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  const prior = checkpoint?.files[relative]?.sha256 ?? null
  const editable = isEditable(relative, harnessPrefix)
  const absolute = path.join(workspaceRoot, relative)

  if (!fileExists(absolute)) {
    return {
      relative_path: relative,
      language,
      absolute_path: absolute,
      editable,
      exists: false,
      status: 'deleted',
      sha256: null,
      checkpoint_sha256: prior,
      issues: [],
    }
  }

  const current = sha256(readText(absolute))

  return {
    relative_path: relative,
    language,
    absolute_path: absolute,
    editable,
    exists: true,
    status: prior && prior === current ? 'unchanged' : 'changed',
    sha256: current,
    checkpoint_sha256: prior,
    issues: styleIssues(workspaceRoot, relative),
  }
}

function scanSummary(files: StyleScanFile[]): StyleScanSummary {
  return {
    files: files.length,
    editable_files: files.filter((file) => file.editable && file.exists).length,
    report_only_files: files.filter((file) => !file.editable && file.exists)
      .length,
    deleted_files: files.filter((file) => !file.exists).length,
    issue_files: files.filter((file) => file.issues.length > 0).length,
    editable_issue_files: files.filter(
      (file) => file.editable && file.issues.length > 0,
    ).length,
    report_only_issue_files: files.filter(
      (file) => !file.editable && file.issues.length > 0,
    ).length,
  }
}

export function scanStyleArtifacts(
  harnessRoot: string,
  options: StyleScanOptions,
): StyleScanResult {
  const checkedAt = new Date().toISOString()
  const workspaceRoot = path.resolve(options.workspace_root)
  const head = gitHead(workspaceRoot)

  if (!head) {
    throw new PanError('Workspace is not a Git repository.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  assertSelection(options)

  const checkpoint = loadCheckpoint(harnessRoot)
  const harnessPrefix = nestedHarnessPrefix(harnessRoot, workspaceRoot)
  const languages = detectedLanguages(harnessRoot, workspaceRoot)
  const languageSet = new Set(languages)
  const base = options.all
    ? head
    : options.since_ref
      ? resolveSinceBase(workspaceRoot, options.since_ref)
      : (checkpoint?.head ?? head)

  // Without a checkpoint there is no committed baseline to diff against, so a
  // git-range selection would collapse to the dirty working tree and hide
  // every committed source file. The first scan therefore inspects the
  // complete eligible set, exactly as `--all` and `style checkpoint` do.
  const candidates =
    options.all || (!options.since_ref && !checkpoint)
      ? gitTrackedWorkspacePaths(workspaceRoot).filter((relative) =>
          isEligiblePath(relative, languageSet),
        )
      : [
          ...new Set([
            ...gitChangedPathsBetween(workspaceRoot, base, head),
            ...gitStatusPaths(workspaceRoot),
          ]),
        ].filter((relative) => isEligiblePath(relative, languageSet))

  const scanned: StyleScanFile[] = []

  for (const candidate of candidates) {
    const entry = scanFile(workspaceRoot, checkpoint, harnessPrefix, candidate)

    if (options.all || entry.status !== 'unchanged') {
      scanned.push(entry)
    }
  }

  if (!options.all && checkpoint) {
    for (const relative of Object.keys(checkpoint.files)) {
      if (
        !isEligiblePath(relative, languageSet) ||
        scanned.some((file) => file.relative_path === relative) ||
        fileExists(path.join(workspaceRoot, relative))
      ) {
        continue
      }

      scanned.push(scanFile(workspaceRoot, checkpoint, harnessPrefix, relative))
    }
  }

  const files = scanned.sort((left, right) =>
    left.relative_path.localeCompare(right.relative_path),
  )
  const summary = scanSummary(files)

  return {
    schema_version: 1,
    status: summary.editable_issue_files > 0 ? 'failed' : 'passed',
    checked_at: checkedAt,
    workspace_root: workspaceRoot,
    head,
    base,
    languages,
    checkpoint_path: STYLE_CACHE_RELATIVE_PATH,
    checkpoint_head: checkpoint?.head ?? null,
    files,
    summary,
  }
}

export function checkpointStyleArtifacts(
  harnessRoot: string,
  options: StyleScanOptions,
): StyleCheckpointResult {
  const checkedAt = new Date().toISOString()
  const workspaceRoot = path.resolve(options.workspace_root)
  const head = gitHead(workspaceRoot)

  if (!head) {
    throw new PanError('Workspace is not a Git repository.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  // Keep flag validation consistent with scan, but checkpoint always inspects
  // the complete eligible set.
  assertSelection(options)

  if (options.since_ref) {
    resolveSinceBase(workspaceRoot, options.since_ref)
  }

  const scan = scanStyleArtifacts(harnessRoot, {
    workspace_root: workspaceRoot,
    all: true,
  })
  const summary = scanSummary(scan.files)

  if (summary.editable_issue_files > 0) {
    return {
      schema_version: 1,
      status: 'blocked',
      checked_at: checkedAt,
      workspace_root: workspaceRoot,
      head,
      languages: scan.languages,
      checkpoint_path: STYLE_CACHE_RELATIVE_PATH,
      wrote_checkpoint: false,
      files: scan.files,
      summary: { ...summary, checkpoint_entries: 0 },
    }
  }

  const files: Record<string, StyleCheckpointFileEntry> = {}

  for (const file of scan.files) {
    if (!file.exists || !file.sha256) {
      continue
    }

    files[file.relative_path] = {
      path: file.relative_path,
      sha256: file.sha256,
      editable: file.editable,
    }
  }

  writeJsonAtomic(path.join(harnessRoot, STYLE_CACHE_RELATIVE_PATH), {
    schema_version: 1,
    head,
    checked_at: checkedAt,
    files,
  } satisfies StyleCheckpointFile)

  return {
    schema_version: 1,
    status: 'passed',
    checked_at: checkedAt,
    workspace_root: workspaceRoot,
    head,
    languages: scan.languages,
    checkpoint_path: STYLE_CACHE_RELATIVE_PATH,
    wrote_checkpoint: true,
    files: scan.files,
    summary: { ...summary, checkpoint_entries: Object.keys(files).length },
  }
}
