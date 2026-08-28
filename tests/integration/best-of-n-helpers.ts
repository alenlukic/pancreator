import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { initBestOfN } from '../../src/lib/best-of-n.js'
import {
  assessStage,
  prepareInvocation,
  submitOutput,
} from '../../src/lib/engine.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import { loadWorkflow, stageBySlug } from '../../src/lib/workflow.js'
import type { StageOutput } from '../../src/lib/types.js'
import { makeOutput, writeCanonicalDelegation, writeJson } from '../helpers.js'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
export const CONFIGS = {
  schema_version: 1,
  candidates: [
    { name: 'alpha', personas: { coder: 'gpt-5.4' } },
    { name: 'beta', personas: { coder: 'claude-opus-5' } },
  ],
  consolidation: { personas: { metacritic: 'gpt-5.6-sol' } },
}

/** Above every supported pid range, so this owner is provably not running. */
export const DEAD_PID = 2 ** 31 - 1
export const EXCLUSION_NOTE = 'Operator stopped this candidate.'

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/** The session id a failed initialization names in its recovery guidance. */
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

export function readSessionState(
  root: string,
  bonId: string,
): ReturnType<typeof initBestOfN> {
  return JSON.parse(
    readFileSync(sessionStatePath(root, bonId), 'utf8'),
  ) as ReturnType<typeof initBestOfN>
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

  const submitted = submitOutput(root, runId, invocation.output.path)

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

/** Advance one autonomous candidate run from plan to a terminal outcome. */
export function driveCandidate(root: string, runId: string): void {
  for (const stageSlug of ['plan', 'implement', 'verify']) {
    submitCandidateStage(root, runId, stageSlug)
  }
}

/** Mutate a verify output into a remediable failing verdict. */
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
