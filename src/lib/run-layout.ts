import { existsSync } from 'node:fs'
import path from 'node:path'

export type RunLayoutVersion = 'v1' | 'v2'

export const CURRENT_RUN_LAYOUT_VERSION: RunLayoutVersion = 'v2'

export interface RunPath {
  absolute: string
  relative: string
}

export interface RunLayout {
  version: RunLayoutVersion
  root: RunPath
  agent: RunPath
  operator: RunPath
  state: RunPath
  events: RunPath
  operationMutex: RunPath
  workflowSnapshot: RunPath
  pipelineConfigSnapshot: RunPath
  request: (extension?: string) => RunPath
  invocation: (invocationId: string, extension: string) => RunPath
  output: (invocationId: string) => RunPath
  assessment: (filename: string) => RunPath
  evidence: (filename: string) => RunPath
  decision: (filename: string) => RunPath
  validation: (filename: string) => RunPath
  artifactJson: (filename: string) => RunPath
  operatorHtml: (artifactId: string) => RunPath
  operatorMarkdown: (filename: string) => RunPath
}

function repoPath(root: string, relative: string): RunPath {
  return {
    absolute: path.join(root, relative),
    relative,
  }
}

function joinRepoPath(root: string, ...segments: string[]): RunPath {
  return repoPath(root, path.posix.join(...segments))
}

export function runRootRelative(runId: string): string {
  return `runtime/logs/workflows/${runId}`
}

/**
 * Detect one run from its own state location.
 *
 * A missing run defaults to the current layout so creation can build the new
 * tree before state.json exists. Existing root-level state always remains v1.
 */
export function detectRunLayout(root: string, runId: string): RunLayoutVersion {
  const runRelative = runRootRelative(runId)
  const agentState = path.join(root, runRelative, 'agent', 'state.json')

  if (existsSync(agentState)) {
    return 'v2'
  }

  const legacyState = path.join(root, runRelative, 'state.json')

  if (existsSync(legacyState)) {
    return 'v1'
  }

  const legacyMarkers = [
    'events.jsonl',
    'workflow.snapshot.json',
    'invocations',
    'outputs',
    'artifacts',
  ]

  if (
    legacyMarkers.some((marker) =>
      existsSync(path.join(root, runRelative, marker)),
    )
  ) {
    return 'v1'
  }

  return CURRENT_RUN_LAYOUT_VERSION
}

export function resolveRunLayout(
  root: string,
  runId: string,
  version: RunLayoutVersion = detectRunLayout(root, runId),
): RunLayout {
  const runRelative = runRootRelative(runId)
  const agentRelative = version === 'v2' ? `${runRelative}/agent` : runRelative
  const operatorRelative =
    version === 'v2' ? `${runRelative}/operator` : runRelative

  const agentPath = (...segments: string[]): RunPath =>
    joinRepoPath(root, agentRelative, ...segments)
  const operatorPath = (...segments: string[]): RunPath =>
    joinRepoPath(root, operatorRelative, ...segments)

  return {
    version,
    root: repoPath(root, runRelative),
    agent: repoPath(root, agentRelative),
    operator: repoPath(root, operatorRelative),
    state: agentPath('state.json'),
    events: agentPath('events.jsonl'),
    operationMutex: agentPath('.operation-mutex'),
    workflowSnapshot: agentPath('workflow.snapshot.json'),
    pipelineConfigSnapshot: agentPath('pipeline-config.snapshot.json'),
    request: (extension = '.md') => operatorPath(`request${extension}`),
    invocation: (invocationId, extension) =>
      agentPath('invocations', `${invocationId}${extension}`),
    output: (invocationId) => agentPath('outputs', `${invocationId}.json`),
    assessment: (filename) => agentPath('assessments', filename),
    evidence: (filename) => agentPath('evidence', filename),
    decision: (filename) => agentPath('decisions', filename),
    validation: (filename) => agentPath('validations', filename),
    artifactJson: (filename) => agentPath('artifacts', 'json', filename),
    operatorHtml: (artifactId) =>
      version === 'v2'
        ? operatorPath(`${artifactId}.html`)
        : joinRepoPath(
            root,
            runRelative,
            'artifacts',
            'html',
            `${artifactId}.html`,
          ),
    operatorMarkdown: (filename) =>
      version === 'v2'
        ? operatorPath(filename)
        : joinRepoPath(root, runRelative, 'artifacts', 'markdown', filename),
  }
}
