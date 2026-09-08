import { readdirSync } from 'node:fs'
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
} from './git.js'
import { isSelfDevelopmentInstallation } from './project-config.js'
import { validateSimplifiedEnglish } from './validators/simplified-english.js'
import type { HandlerInput, HandlerResult } from './requirements/types.js'

export const CONFORM_CACHE_RELATIVE_PATH = 'runtime/cache/conform.json'

/**
 * Which root a candidate is resolved against. `runtime` is the harness root,
 * which owns every editable conform artifact. `workspace` is the repository the
 * harness governs, and in a target installation that repository owns its own
 * tracked files, so no `workspace` candidate is ever editable.
 */
type ConformRoot = 'workspace' | 'runtime'

export interface ConformCheckpointFileEntry {
  path: string
  sha256: string
  editable: boolean
}

export interface ConformCheckpointFile {
  schema_version: 1
  head: string
  checked_at: string
  files: Record<string, ConformCheckpointFileEntry>
}

export interface ConformScanOptions {
  workspace_root: string
  since_ref?: string | null
  all?: boolean
}

export interface ConformScanFile {
  key: string
  root: ConformRoot
  relative_path: string
  absolute_path: string
  editable: boolean
  exists: boolean
  status: 'unchanged' | 'changed' | 'deleted'
  sha256: string | null
  checkpoint_sha256: string | null
  issues: HandlerResult['issues']
}

export interface ConformScanResult {
  schema_version: 1
  status: 'passed' | 'failed'
  checked_at: string
  workspace_root: string
  head: string
  base: string
  checkpoint_path: string
  checkpoint_head: string | null
  files: ConformScanFile[]
  summary: {
    files: number
    editable_files: number
    report_only_files: number
    deleted_files: number
    issue_files: number
    editable_issue_files: number
    report_only_issue_files: number
  }
}

export interface ConformCheckpointResult {
  schema_version: 1
  status: 'passed' | 'blocked'
  checked_at: string
  workspace_root: string
  head: string
  checkpoint_path: string
  wrote_checkpoint: boolean
  files: ConformScanFile[]
  summary: ConformScanResult['summary'] & {
    checkpoint_entries: number
  }
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

/**
 * The workspace root is the governed repository, so only the one artifact
 * Pancreator itself owns is eligible, and only when Pancreator is that
 * repository. A target installation contributes no workspace candidate: the
 * target owns its tracked files, and `LIBRARIAN-001` forbids imposing
 * Pancreator writing rules on them.
 */
function isEligibleWorkspacePath(
  relativePath: string,
  selfDevelopment: boolean,
): boolean {
  return selfDevelopment && toPosix(relativePath) === 'CHANGELOG.md'
}

/** Harness-owned intake records, which live beside the harness, not the target. */
function isEligibleHarnessIssuesPath(relativePath: string): boolean {
  const rel = toPosix(relativePath)

  return rel.startsWith('docs/issues/') && rel.endsWith('.md')
}

function isEligibleRuntimeMarkdownPath(relativePath: string): boolean {
  const rel = toPosix(relativePath)

  if (isEligibleHarnessIssuesPath(rel)) {
    return true
  }

  return (
    rel.startsWith('runtime/pr-descriptions/') &&
    rel.endsWith('.md') &&
    path.posix.dirname(rel) === 'runtime/pr-descriptions'
  )
}

function isEligibleRuntimeHtmlPath(relativePath: string): boolean {
  const rel = toPosix(relativePath)

  if (!rel.startsWith('runtime/logs/workflows/')) {
    return false
  }

  return (
    (rel.endsWith('.html') || rel.endsWith('.htm')) &&
    path.posix.dirname(rel).endsWith('/operator')
  )
}

function isEligibleRuntimePath(relativePath: string): boolean {
  return (
    isEligibleRuntimeMarkdownPath(relativePath) ||
    isEligibleRuntimeHtmlPath(relativePath)
  )
}

function checkpointKey(root: ConformRoot, relativePath: string): string {
  return `${root}:${toPosix(relativePath)}`
}

function parseCheckpointKey(
  key: string,
): { root: ConformRoot; relative_path: string } | null {
  if (key.startsWith('workspace:')) {
    return { root: 'workspace', relative_path: key.slice('workspace:'.length) }
  }

  if (key.startsWith('runtime:')) {
    return { root: 'runtime', relative_path: key.slice('runtime:'.length) }
  }

  return null
}

function loadCheckpoint(harnessRoot: string): ConformCheckpointFile | null {
  const absolute = path.join(harnessRoot, CONFORM_CACHE_RELATIVE_PATH)

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

    const files: Record<string, ConformCheckpointFileEntry> = {}

    for (const [key, entry] of Object.entries(value.files)) {
      if (
        typeof key !== 'string' ||
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
    // This checkpoint is local derived state. A corrupt checkpoint is treated as
    // missing rather than as a hard failure.
    return null
  }
}

function listHarnessMarkdownIssuesFiles(harnessRoot: string): string[] {
  const base = path.join(harnessRoot, 'docs', 'issues')

  if (!fileExists(base)) {
    return []
  }

  const found: string[] = []
  const stack: Array<{ absolute: string; relative: string }> = [
    { absolute: base, relative: 'docs/issues' },
  ]

  while (stack.length > 0) {
    const next = stack.pop()

    if (!next) {
      continue
    }

    for (const entry of readdirSync(next.absolute, { withFileTypes: true })) {
      const absolute = path.join(next.absolute, entry.name)
      const relative = `${next.relative}/${entry.name}`

      if (entry.isDirectory()) {
        stack.push({ absolute, relative })
        continue
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        found.push(relative)
      }
    }
  }

  return found.sort()
}

function listRuntimePrDescriptions(harnessRoot: string): string[] {
  const base = path.join(harnessRoot, 'runtime', 'pr-descriptions')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => `runtime/pr-descriptions/${entry.name}`)
    .sort()
}

function listRuntimeWorkflowOperatorHtml(harnessRoot: string): string[] {
  const workflows = path.join(harnessRoot, 'runtime', 'logs', 'workflows')

  if (!fileExists(workflows)) {
    return []
  }

  const found: string[] = []

  for (const entry of readdirSync(workflows, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const operatorDir = path.join(workflows, entry.name, 'operator')

    if (!fileExists(operatorDir)) {
      continue
    }

    for (const child of readdirSync(operatorDir, { withFileTypes: true })) {
      if (!child.isFile()) {
        continue
      }

      const lower = child.name.toLowerCase()

      if (!lower.endsWith('.html') && !lower.endsWith('.htm')) {
        continue
      }

      found.push(`runtime/logs/workflows/${entry.name}/operator/${child.name}`)
    }
  }

  return found.sort()
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

function fileChecksum(absolutePath: string): string {
  return sha256(readText(absolutePath))
}

function validateFile(root: string, relativePath: string): HandlerResult {
  const input: HandlerInput = {
    root,
    targetPath: relativePath,
    requirement: {
      policy_id: 'STE-001',
      requirement_id: 'standalone-conform-simplified-english-validate',
      registry_id: 'SIMPLIFIED-ENGLISH-VALIDATE-001',
      arguments: {},
    },
  }

  return validateSimplifiedEnglish(input)
}

/**
 * `CHANGELOG.md` is release metadata. `AGENTS.md` and the release-steward
 * persona reserve it for a ship stage and `/pan-release`, so conform reports
 * its issues and never edits it. Every editable artifact is harness-owned.
 */
function isEditable(root: ConformRoot, relativePath: string): boolean {
  return root === 'runtime' && isEligibleRuntimeMarkdownPath(relativePath)
}

function absolutePathOf(
  root: ConformRoot,
  workspaceRoot: string,
  harnessRoot: string,
  relativePath: string,
): string {
  return path.join(
    root === 'workspace' ? workspaceRoot : harnessRoot,
    relativePath,
  )
}

function scanFile(
  harnessRoot: string,
  workspaceRoot: string,
  checkpoint: ConformCheckpointFile | null,
  root: ConformRoot,
  relativePath: string,
): ConformScanFile {
  const posixPath = toPosix(relativePath)
  const key = checkpointKey(root, posixPath)
  const prior = checkpoint?.files[key]?.sha256 ?? null
  const editable = isEditable(root, posixPath)
  const absolute = absolutePathOf(root, workspaceRoot, harnessRoot, posixPath)
  const exists = fileExists(absolute)

  if (!exists) {
    return {
      key,
      root,
      relative_path: posixPath,
      absolute_path: absolute,
      editable,
      exists: false,
      status: 'deleted',
      sha256: null,
      checkpoint_sha256: prior,
      issues: [],
    }
  }

  const current = fileChecksum(absolute)
  const issues = validateFile(
    root === 'workspace' ? workspaceRoot : harnessRoot,
    posixPath,
  ).issues

  return {
    key,
    root,
    relative_path: posixPath,
    absolute_path: absolute,
    editable,
    exists: true,
    status: prior && prior === current ? 'unchanged' : 'changed',
    sha256: current,
    checkpoint_sha256: prior,
    issues,
  }
}

function scanSummary(files: ConformScanFile[]): ConformScanResult['summary'] {
  const editableFiles = files.filter((file) => file.editable && file.exists)
  const reportOnlyFiles = files.filter((file) => !file.editable && file.exists)
  const deletedFiles = files.filter((file) => !file.exists)
  const issueFiles = files.filter((file) => file.issues.length > 0)
  const editableIssueFiles = files.filter(
    (file) => file.editable && file.issues.length > 0,
  )
  const reportOnlyIssueFiles = files.filter(
    (file) => !file.editable && file.issues.length > 0,
  )

  return {
    files: files.length,
    editable_files: editableFiles.length,
    report_only_files: reportOnlyFiles.length,
    deleted_files: deletedFiles.length,
    issue_files: issueFiles.length,
    editable_issue_files: editableIssueFiles.length,
    report_only_issue_files: reportOnlyIssueFiles.length,
  }
}

function listEligibleWorkspacePaths(
  workspaceRoot: string,
  selfDevelopment: boolean,
): string[] {
  const paths: string[] = []

  if (fileExists(path.join(workspaceRoot, 'CHANGELOG.md'))) {
    paths.push('CHANGELOG.md')
  }

  return paths
    .filter((relativePath) =>
      isEligibleWorkspacePath(relativePath, selfDevelopment),
    )
    .sort()
}

function listEligibleRuntimePaths(harnessRoot: string): string[] {
  const paths: string[] = []

  paths.push(...listHarnessMarkdownIssuesFiles(harnessRoot))
  paths.push(...listRuntimePrDescriptions(harnessRoot))
  paths.push(...listRuntimeWorkflowOperatorHtml(harnessRoot))

  return paths
    .filter((relativePath) => isEligibleRuntimePath(relativePath))
    .sort()
}

export function scanConformArtifacts(
  harnessRoot: string,
  options: ConformScanOptions,
): ConformScanResult {
  const checkedAt = new Date().toISOString()
  const workspaceRoot = path.resolve(options.workspace_root)
  const checkpoint = loadCheckpoint(harnessRoot)
  const selfDevelopment = isSelfDevelopmentInstallation(harnessRoot)

  const head = gitHead(workspaceRoot)

  if (!head) {
    throw new PanError('Workspace is not a Git repository.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (options.since_ref && options.all) {
    throw new PanError('--since and --all cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  const base = options.all
    ? head
    : options.since_ref
      ? resolveSinceBase(workspaceRoot, options.since_ref)
      : (checkpoint?.head ?? head)

  // Without a checkpoint there is no committed baseline to diff against, so a
  // git-range selection would collapse to the dirty working tree and hide every
  // committed artifact. The first scan therefore inspects the complete eligible
  // set, exactly as `--all` and `conform checkpoint` already do.
  const workspaceCandidates =
    options.all || (!options.since_ref && !checkpoint)
      ? new Set(listEligibleWorkspacePaths(workspaceRoot, selfDevelopment))
      : new Set(
          [
            ...gitChangedPathsBetween(workspaceRoot, base, head),
            ...gitStatusPaths(workspaceRoot),
          ].filter((relativePath) =>
            isEligibleWorkspacePath(relativePath, selfDevelopment),
          ),
        )

  const runtimeCandidates = new Set(listEligibleRuntimePaths(harnessRoot))

  const candidates: Array<{ root: ConformRoot; relative_path: string }> = [
    ...[...workspaceCandidates].sort().map((relative_path) => ({
      root: 'workspace' as const,
      relative_path,
    })),
    ...[...runtimeCandidates].sort().map((relative_path) => ({
      root: 'runtime' as const,
      relative_path,
    })),
  ]

  const scanned: ConformScanFile[] = []

  for (const candidate of candidates) {
    const entry = scanFile(
      harnessRoot,
      workspaceRoot,
      checkpoint,
      candidate.root,
      candidate.relative_path,
    )

    if (options.all) {
      scanned.push(entry)
      continue
    }

    if (entry.status === 'changed' || entry.status === 'deleted') {
      scanned.push(entry)
    }
  }

  if (!options.all && checkpoint) {
    for (const key of Object.keys(checkpoint.files)) {
      const parsed = parseCheckpointKey(key)

      if (!parsed) {
        continue
      }

      if (
        parsed.root === 'workspace' &&
        !isEligibleWorkspacePath(parsed.relative_path, selfDevelopment)
      ) {
        continue
      }

      if (
        parsed.root === 'runtime' &&
        !isEligibleRuntimePath(parsed.relative_path)
      ) {
        continue
      }

      const already = scanned.some((file) => file.key === key)
      const absolute = absolutePathOf(
        parsed.root,
        workspaceRoot,
        harnessRoot,
        parsed.relative_path,
      )
      const exists = fileExists(absolute)

      if (!already && !exists) {
        scanned.push(
          scanFile(
            harnessRoot,
            workspaceRoot,
            checkpoint,
            parsed.root,
            parsed.relative_path,
          ),
        )
      }
    }
  }

  const files = scanned
    .sort((left, right) => left.key.localeCompare(right.key))
    .filter((file) => options.all || file.status !== 'unchanged')

  const summary = scanSummary(files)

  return {
    schema_version: 1,
    status: summary.editable_issue_files > 0 ? 'failed' : 'passed',
    checked_at: checkedAt,
    workspace_root: workspaceRoot,
    head,
    base,
    checkpoint_path: CONFORM_CACHE_RELATIVE_PATH,
    checkpoint_head: checkpoint?.head ?? null,
    files,
    summary,
  }
}

export function checkpointConformArtifacts(
  harnessRoot: string,
  options: ConformScanOptions,
): ConformCheckpointResult {
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
  if (options.since_ref && options.all) {
    throw new PanError('--since and --all cannot be used together.', {
      code: 'INVALID_ARGUMENT',
    })
  }

  if (options.since_ref) {
    resolveSinceBase(workspaceRoot, options.since_ref)
  }

  const scan = scanConformArtifacts(harnessRoot, {
    workspace_root: workspaceRoot,
    all: true,
  })

  const editableIssueFiles = scan.files.filter(
    (file) => file.editable && file.issues.length > 0,
  )

  const summary = scanSummary(scan.files)
  const checkpointPath = path.join(harnessRoot, CONFORM_CACHE_RELATIVE_PATH)

  if (editableIssueFiles.length > 0) {
    return {
      schema_version: 1,
      status: 'blocked',
      checked_at: checkedAt,
      workspace_root: workspaceRoot,
      head,
      checkpoint_path: CONFORM_CACHE_RELATIVE_PATH,
      wrote_checkpoint: false,
      files: scan.files,
      summary: {
        ...summary,
        checkpoint_entries: 0,
      },
    }
  }

  const files: Record<string, ConformCheckpointFileEntry> = {}

  for (const file of scan.files) {
    if (!file.exists || !file.sha256) {
      continue
    }

    files[file.key] = {
      path: file.relative_path,
      sha256: file.sha256,
      editable: file.editable,
    }
  }

  writeJsonAtomic(checkpointPath, {
    schema_version: 1,
    head,
    checked_at: checkedAt,
    files,
  } satisfies ConformCheckpointFile)

  return {
    schema_version: 1,
    status: 'passed',
    checked_at: checkedAt,
    workspace_root: workspaceRoot,
    head,
    checkpoint_path: CONFORM_CACHE_RELATIVE_PATH,
    wrote_checkpoint: true,
    files: scan.files,
    summary: {
      ...summary,
      checkpoint_entries: Object.keys(files).length,
    },
  }
}
