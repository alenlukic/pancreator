import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { invariant } from '../errors.js'
import { inboxTemporalScanDirectories } from '../inbox.js'
import { isRecord, writeJsonAtomic } from '../io.js'
import { loadState } from '../state.js'
import type { RunState } from '../types.js'
import { isInvocationAliasFile, recordInvocationAliases } from './aliases.js'
import {
  agentDirectory,
  isClosedRunStatus,
  listFiles,
  replaceMappings,
  replacementMappings,
  replaceStringsInValue,
  rewriteRunStateValue,
  rewriteStructuredFiles,
  stageOccurrences,
  textFileContent,
  toRepoRelative,
  type FileMove,
  type WorkflowArtifactRewriteSummary,
  type WorkflowArtifactSequenceMode,
} from './identity.js'

export function isContentAddressedArtifact(filePath: string): boolean {
  return /(?:^|[/\\])(?:state-revision-\d+-[a-f0-9]{64}|event-payload-[a-f0-9]{64}|repository-check-delta-[a-f0-9]{64})\.json$/u.test(
    filePath,
  )
}

export function updateFiles(
  files: string[],
  mappings: ReadonlyMap<string, string>,
  updatedFiles: Set<string>,
): void {
  if (mappings.size === 0) {
    return
  }

  for (const filePath of files) {
    const content = textFileContent(filePath)

    if (content === null) {
      continue
    }

    const updated = replaceMappings(content, mappings)

    if (updated !== content) {
      writeFileSync(filePath, updated, 'utf8')
      updatedFiles.add(filePath)
    }
  }
}

/**
 * Every run-owned inbox item, wherever the lifecycle currently holds it.
 *
 * This scanner feeds the finalization rewrite that repairs invocation ids
 * quoted inside a run's own inbox item after terminal renumbering. It once
 * read the inbox root alone, which was correct until the lifecycle partition
 * moved every new item into `queue/`; it then matched nothing and the rewrite
 * became silent dead code. The directory list comes from the inbox module so
 * a future lifecycle directory reaches both surfaces at once, and the root
 * stays in the list because legacy loose items still resolve there.
 */
export function exactRunInboxFiles(root: string, runId: string): string[] {
  const directories = [
    path.join('runtime', 'inbox'),
    ...inboxTemporalScanDirectories(),
  ]

  return directories
    .flatMap((relative) => {
      const directory = path.join(root, relative)

      if (!existsSync(directory)) {
        return []
      }

      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith(runId))
        .map((entry) => path.join(directory, entry.name))
    })
    .sort()
}

function migratedArtifactName(
  name: string,
  mappings: ReadonlyMap<string, string>,
): string {
  for (const [oldInvocationId, newInvocationId] of mappings) {
    if (name === `assessment-${oldInvocationId}.request.json`) {
      return `${newInvocationId}.assessment-request.json`
    }

    if (name === `assessment-${oldInvocationId}.json`) {
      return `${newInvocationId}.assessment.json`
    }
  }

  return replaceMappings(name, mappings)
}

function applyFileRenames(
  files: string[],
  mappings: ReadonlyMap<string, string>,
): number {
  const plans = files.flatMap((source) => {
    const name = path.basename(source)
    const nextName = migratedArtifactName(name, mappings)

    return nextName === name
      ? []
      : [{ source, target: path.join(path.dirname(source), nextName) }]
  })

  if (plans.length === 0) {
    return 0
  }

  const sources = new Set(plans.map((plan) => plan.source))

  for (const plan of plans) {
    invariant(
      !existsSync(plan.target) || sources.has(plan.target),
      `Artifact rename target already exists: ${plan.target}`,
      { code: 'ARTIFACT_RENAME_COLLISION' },
    )
  }

  const temporary = plans.map((plan) => {
    const temp = `${plan.source}.renaming-${randomUUID()}`

    renameSync(plan.source, temp)

    return { temp, target: plan.target }
  })

  for (const plan of temporary) {
    renameSync(plan.temp, plan.target)
  }

  return plans.length
}

interface FileRemoval {
  source: string
  sourceRelative: string
  targetRelative: string
}

interface ArtifactLayoutPlan {
  moves: FileMove[]
  removals: FileRemoval[]
}

function recordJsonTarget(
  artifactRoot: string,
  relativeMarkdownPath: string,
): string {
  const normalized = relativeMarkdownPath.endsWith('.record.md')
    ? relativeMarkdownPath.slice(0, -'.record.md'.length)
    : relativeMarkdownPath.slice(0, -path.extname(relativeMarkdownPath).length)

  return path.join(artifactRoot, 'json', `${normalized}.json`)
}

function removal(
  root: string,
  artifactRoot: string,
  source: string,
  relativeMarkdownPath: string,
): FileRemoval {
  const target = recordJsonTarget(artifactRoot, relativeMarkdownPath)

  return {
    source,
    sourceRelative: toRepoRelative(root, source),
    targetRelative: toRepoRelative(root, target),
  }
}

function layoutPlan(root: string, runDirectory: string): ArtifactLayoutPlan {
  const artifactRoot = path.join(runDirectory, 'artifacts')
  const recordsRoot = path.join(runDirectory, 'records')
  const moves: FileMove[] = []
  const removals: FileRemoval[] = []

  for (const source of listFiles(recordsRoot)) {
    const relative = path.relative(recordsRoot, source)
    const extension = path.extname(source)

    if (extension === '.json') {
      const target = path.join(artifactRoot, 'json', relative)

      moves.push({
        source,
        target,
        sourceRelative: toRepoRelative(root, source),
        targetRelative: toRepoRelative(root, target),
      })
    } else if (extension === '.md') {
      removals.push(removal(root, artifactRoot, source, relative))
    } else {
      invariant(false, `Unsupported record artifact: ${source}`, {
        code: 'UNSUPPORTED_RECORD_ARTIFACT',
      })
    }
  }

  const markdownRoot = path.join(artifactRoot, 'markdown')

  for (const source of listFiles(markdownRoot)) {
    if (!source.endsWith('.record.md')) {
      continue
    }

    removals.push(
      removal(root, artifactRoot, source, path.relative(markdownRoot, source)),
    )
  }

  if (existsSync(artifactRoot)) {
    for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        (entry.name === 'json' ||
          entry.name === 'html' ||
          entry.name === 'markdown')
      ) {
        continue
      }

      const sourceRoot = path.join(artifactRoot, entry.name)
      const files = entry.isDirectory() ? listFiles(sourceRoot) : [sourceRoot]

      for (const source of files) {
        const relative = path.relative(artifactRoot, source)

        if (source.endsWith('.record.md')) {
          removals.push(removal(root, artifactRoot, source, relative))

          continue
        }

        const targetDirectory = source.endsWith('.json')
          ? 'json'
          : source.endsWith('.html')
            ? 'html'
            : 'markdown'
        const target = path.join(artifactRoot, targetDirectory, relative)

        moves.push({
          source,
          target,
          sourceRelative: toRepoRelative(root, source),
          targetRelative: toRepoRelative(root, target),
        })
      }
    }
  }

  return { moves, removals }
}

function applyLayoutMoves(moves: FileMove[]): void {
  const sources = new Set(moves.map((move) => move.source))

  for (const move of moves) {
    invariant(
      !existsSync(move.target) || sources.has(move.target),
      `Artifact layout target already exists: ${move.target}`,
      { code: 'ARTIFACT_LAYOUT_COLLISION' },
    )
  }

  const temporary = moves.map((move) => {
    mkdirSync(path.dirname(move.target), { recursive: true })

    const temp = `${move.source}.moving-${randomUUID()}`

    renameSync(move.source, temp)

    return { temp, target: move.target }
  })

  for (const move of temporary) {
    renameSync(move.temp, move.target)
  }
}

function applyLayoutRemovals(removals: FileRemoval[]): void {
  for (const item of removals) {
    rmSync(item.source, { force: true })
  }
}

function consolidateArtifactLayout(
  root: string,
  runDirectory: string,
): { changed: number; mappings: Map<string, string> } {
  if (agentDirectory(runDirectory) !== runDirectory) {
    mkdirSync(path.join(runDirectory, 'agent', 'artifacts', 'json'), {
      recursive: true,
    })
    mkdirSync(path.join(runDirectory, 'operator'), { recursive: true })

    return { changed: 0, mappings: new Map() }
  }

  const artifactRoot = path.join(runDirectory, 'artifacts')

  mkdirSync(path.join(artifactRoot, 'json'), { recursive: true })
  mkdirSync(path.join(artifactRoot, 'html'), { recursive: true })
  mkdirSync(path.join(artifactRoot, 'markdown'), { recursive: true })

  const plan = layoutPlan(root, runDirectory)

  applyLayoutMoves(plan.moves)
  applyLayoutRemovals(plan.removals)
  rmSync(path.join(runDirectory, 'records'), { recursive: true, force: true })

  for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      entry.name !== 'json' &&
      entry.name !== 'html' &&
      entry.name !== 'markdown'
    ) {
      rmSync(path.join(artifactRoot, entry.name), {
        recursive: true,
        force: true,
      })
    }
  }

  const changes = [...plan.moves, ...plan.removals]

  return {
    changed: changes.length,
    mappings: new Map(
      changes.map((item) => [item.sourceRelative, item.targetRelative]),
    ),
  }
}

function replaceRunStateObject(
  state: RunState,
  mappings: ReadonlyMap<string, string>,
): void {
  const rewritten = replaceStringsInValue(state, mappings)

  invariant(isRecord(rewritten), 'Rewritten run state MUST remain an object.', {
    code: 'INVALID_REWRITTEN_STATE',
  })

  for (const key of Object.keys(state)) {
    delete (state as unknown as Record<string, unknown>)[key]
  }

  Object.assign(state, rewritten)
}

export function rewriteWorkflowArtifacts(
  root: string,
  runId: string,
  mode: WorkflowArtifactSequenceMode,
  state?: RunState,
): WorkflowArtifactRewriteSummary {
  const runDirectory = path.join(root, 'runtime', 'logs', 'workflows', runId)

  invariant(existsSync(runDirectory), `Unknown run: ${runId}`, {
    code: 'RUN_NOT_FOUND',
  })

  const stateDirectory = path.join(root, 'runtime', 'workflows', runId)
  const occurrences = stageOccurrences(runDirectory, mode)
  const mappings = replacementMappings(occurrences)
  const updatedFiles = new Set<string>()

  rewriteStructuredFiles(runDirectory, occurrences, mappings, updatedFiles)
  // Content-addressed artifacts are immutable history: their recorded digests
  // cover the written bytes, so rewriting invocation ids inside them would
  // invalidate every state_ref/payload_ref/full_delta_ref that names them and
  // make loadState/loadStateRevision fail their checksums after finalization.
  updateFiles(
    listFiles(runDirectory).filter(
      (filePath) =>
        !isContentAddressedArtifact(filePath) &&
        !isInvocationAliasFile(filePath),
    ),
    mappings,
    updatedFiles,
  )
  updateFiles(listFiles(stateDirectory), mappings, updatedFiles)
  updateFiles(exactRunInboxFiles(root, runId), mappings, updatedFiles)

  if (state) {
    const rewritten = rewriteRunStateValue(state, occurrences, mappings)

    invariant(
      isRecord(rewritten),
      'Rewritten run state MUST remain an object.',
      {
        code: 'INVALID_REWRITTEN_STATE',
      },
    )
    Object.assign(state, rewritten)
  }

  const artifactFiles =
    applyFileRenames(listFiles(runDirectory), mappings) +
    applyFileRenames(listFiles(stateDirectory), mappings)
  const layout = consolidateArtifactLayout(root, runDirectory)

  updateFiles(
    listFiles(runDirectory).filter(
      (filePath) => !isInvocationAliasFile(filePath),
    ),
    layout.mappings,
    updatedFiles,
  )
  updateFiles(listFiles(stateDirectory), layout.mappings, updatedFiles)
  updateFiles(exactRunInboxFiles(root, runId), layout.mappings, updatedFiles)

  if (state) {
    replaceRunStateObject(state, layout.mappings)
    writeJsonAtomic(
      path.join(agentDirectory(runDirectory), 'state.json'),
      state,
    )
  }

  recordInvocationAliases(runDirectory, runId, occurrences)

  return {
    artifact_files: artifactFiles,
    layout_files: layout.changed,
    updated_files: updatedFiles.size,
  }
}

export function finalizeWorkflowArtifacts(
  root: string,
  runId: string,
  activeState?: RunState,
): WorkflowArtifactRewriteSummary {
  const state = activeState ?? loadState(root, runId)

  invariant(isClosedRunStatus(state.status), 'Run is not closed.', {
    code: 'RUN_NOT_TERMINAL',
  })

  return rewriteWorkflowArtifacts(root, runId, 'completed', state)
}
