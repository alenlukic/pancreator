import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  abandonBestOfNCandidate,
  consolidateBestOfN,
  initBestOfN,
} from '../../src/lib/best-of-n.js'
import type { BestOfNState } from '../../src/lib/best-of-n.js'
import { assessStage, prepareInvocation } from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import {
  attestRunCard,
  createFixture,
  makeOutput,
  writeCanonicalDelegation,
  writeJson,
  cloneTree as cloneSharedTree,
  submitAsSupervisor,
} from '../helpers.js'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
export const CONFIGS = {
  schema_version: 1,
  candidates: [
    { name: 'alpha', personas: { coder: 'gpt-5.4' } },
    { name: 'beta', personas: { coder: 'claude-opus-5' } },
  ],
  consolidation: { personas: { metacritic: 'gpt-5.6-sol' } },
}

/** Above every supported pid range, so no process owns this pid. */
export const DEAD_PID = 2 ** 31 - 1
export const EXCLUSION_NOTE = 'Operator stopped this candidate.'

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

export function sessionIdFromFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const match = /runtime\/logs\/best-of-n\/([^/]+)\/state\.json/u.exec(message)

  assert.ok(match, `failure names the partial session record: ${message}`)

  return match[1]
}

export function initSession(
  root: string,
  operatorArtifacts = false,
): ReturnType<typeof initBestOfN> {
  writeJson(path.join(root, 'best-of-n.json'), CONFIGS)

  return initBestOfN(root, {
    requestPath: 'request.md',
    configsPath: 'best-of-n.json',
    operatorArtifacts,
  })
}

export function sessionStatePath(root: string, bonId: string): string {
  return path.join(root, 'runtime', 'logs', 'best-of-n', bonId, 'state.json')
}

export function readSessionState(root: string, bonId: string): BestOfNState {
  return JSON.parse(
    readFileSync(sessionStatePath(root, bonId), 'utf8'),
  ) as BestOfNState
}

/** Mark a child run terminal so lifecycle guards treat it as finished. */
export function terminateRun(root: string, runId: string): void {
  const runStatePath = resolveRunLayout(root, runId).state.absolute
  const state = JSON.parse(readFileSync(runStatePath, 'utf8')) as Record<
    string,
    unknown
  >

  writeJson(runStatePath, { ...state, status: 'canceled' })
}

export function submitCandidateStage(
  root: string,
  runId: string,
  stageSlug: string,
  outcome: 'success' | 'failure' = 'success',
  mutate?: (output: StageOutput) => void,
) {
  const workflow = loadWorkflow(root, 'delivery-candidate')

  attestRunCard(root, runId)

  const prepared = prepareInvocation(root, runId)
  const invocation = prepared.invocation

  assert.ok(invocation, `${stageSlug}: expected an invocation`)
  assert.equal(invocation.stage.slug, stageSlug)

  const stage = stageBySlug(workflow, stageSlug)
  const output = makeOutput(root, invocation, stage, outcome)

  mutate?.(output)
  writeJson(path.join(root, invocation.output.path), output)

  if (stage.persona !== 'orchestrator') {
    writeCanonicalDelegation(root, invocation)
  }

  const submitted = submitAsSupervisor(root, runId, invocation.output.path)

  assert.equal(
    submitted.record.outcome,
    outcome,
    `${stageSlug}: ${JSON.stringify(submitted.record.evaluation)}`,
  )

  if (submitted.state.pending_action.type !== 'supervisor_assessment') {
    return submitted.state
  }

  const assessmentPath = submitted.state.pending_action.output_path

  writeJson(path.join(root, assessmentPath), {
    schema_version: 1,
    assessment_id: randomUUID(),
    invocation_id: invocation.invocation_id,
    verdict: 'pass',
    summary: 'Fixture assessment.',
    criteria: stage.criteria.map((criterion) => ({
      id: criterion.id,
      result: 'pass',
      evidence: [invocation.output.path],
      explanation: 'Fixture evidence',
    })),
  })

  return assessStage(root, runId, assessmentPath).state
}

export function driveCandidate(root: string, runId: string): void {
  for (const stageSlug of ['plan', 'implement', 'verify']) {
    submitCandidateStage(root, runId, stageSlug)
  }
}

export function failCandidateVerify(
  findingId: string,
): (output: StageOutput) => void {
  return (output) => {
    output.data.verify = {
      verdict: 'fail_remedial',
      findings: [
        {
          id: findingId,
          severity: 'blocker',
          source: 'qa',
          statement: 'The candidate fixture does not advance.',
          evidence: ['fixture'],
        },
      ],
      qa_cases: [
        {
          id: 'TP-01',
          steps: 'Run workflow fixture',
          expected: 'advance',
          actual: 'stalled',
          result: 'fail',
        },
      ],
      acceptance_results: [
        { id: 'AC-01', result: 'fail', evidence: ['fixture'] },
      ],
      remediation_guidance:
        'Rerun the workflow fixture; the candidate stalls before verification.',
    }
    output.criteria = output.criteria.map((criterion) => ({
      ...criterion,
      result: criterion.id === 'verify.acceptance_met' ? 'fail' : 'pass',
    }))
  }
}

// The process builds each session template once and clones it per call. Every
// clone repairs its worktrees, so no test writes through a stale gitdir
// pointer into the template.

export type BestOfNCheckpointKey = 'ready' | 'consolidated'

export interface BestOfNCheckpoint {
  root: string
  session: BestOfNState
}

const bestOfNCheckpointTemplates = new Map<
  BestOfNCheckpointKey,
  { root: string; bonId: string }
>()

function buildBestOfNTemplate(key: BestOfNCheckpointKey): {
  root: string
  bonId: string
} {
  if (key === 'ready') {
    const root = createFixture()
    const session = initSession(root)

    return { root, bonId: session.bon_id }
  }

  // `consolidated` extends `ready`. The consolidation run exists but has not
  // started.
  const { root, session } = bestOfNCheckpoint('ready')
  const [alpha, beta] = session.candidates

  driveCandidate(root, alpha.run_id)
  abandonBestOfNCandidate(root, session.bon_id, beta.run_id, EXCLUSION_NOTE)
  consolidateBestOfN(root, session.bon_id)

  return { root, bonId: session.bon_id }
}

export function cloneTree(template: string): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-v2-'))

  cloneSharedTree(template, root, { timeout: 180_000 })

  // Worktree bookkeeping compares Git's realpath output with the root, so hand
  // out the root in the form the CLI sees from process.cwd().
  return realpathSync(root)
}

/**
 * Re-point every linked worktree at the clone and prove that no registration
 * names another repository.
 */
export function repairClonedWorktrees(
  root: string,
  relativeWorktreePaths: string[],
): void {
  if (relativeWorktreePaths.length > 0) {
    execFileSync(
      'git',
      [
        'worktree',
        'repair',
        ...relativeWorktreePaths.map((relative) => path.join(root, relative)),
      ],
      { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' },
    )
  }

  const registered = git(root, ['worktree', 'list', '--porcelain'])
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())

  for (const entry of registered) {
    assert.ok(
      entry === root || entry.startsWith(`${root}${path.sep}`),
      `cloned checkpoint registers a foreign worktree: ${entry}`,
    )
  }

  for (const relative of relativeWorktreePaths) {
    assert.ok(
      registered.includes(path.join(root, relative)),
      `cloned checkpoint lost worktree ${relative}`,
    )
  }
}

export function bestOfNCheckpoint(
  key: BestOfNCheckpointKey,
): BestOfNCheckpoint {
  let template = bestOfNCheckpointTemplates.get(key)

  if (!template) {
    template = buildBestOfNTemplate(key)
    bestOfNCheckpointTemplates.set(key, template)
  }

  const root = cloneTree(template.root)
  const session = readSessionState(root, template.bonId)

  repairClonedWorktrees(
    root,
    session.candidates.map((candidate) => candidate.worktree_path),
  )

  return { root, session }
}
