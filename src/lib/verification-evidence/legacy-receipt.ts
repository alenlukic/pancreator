import path from 'node:path'

import { invariant } from '../errors.js'
import { gitHead, gitRevParse } from '../git/core.js'
import { INTEGRATION_BRANCH } from '../git/branches.js'
import {
  fileExists,
  isRecord,
  readJson,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import { listRunStates, loadState } from '../state.js'
import { releaseSourceFingerprint } from '../release-source.js'
import { resolveWorktreeWorkspace } from '../worktree/create.js'
import { workspaceRepositoryRoot } from '../worktree/registry.js'
import type { RunState } from '../types.js'

export interface ReleaseEvidenceBundle {
  schema_version: 1
  worktree: string
  run_id: string
  invocation_id: string
  tip: string
  source_fingerprint: string
  profile: string
  evidence_path: string
  candidate_head: string
  collected_at: string
}

function bundlePath(root: string, worktree: string): string {
  resolveWorktreeWorkspace(root, worktree)
  return resolveInside(
    root,
    path.join('runtime', 'release', 'evidence', `${worktree}.json`),
  )
}

function currentProof(
  state: RunState,
  fingerprint: string,
): { invocation: string; profile: string; evidence: string } | null {
  const latest = [...state.stage_history]
    .reverse()
    .find((item) => item.stage === 'verify')
  if (latest?.outcome !== 'success') return null
  const proof = latest.deterministic?.find(
    (result) =>
      (result.id === 'verify.final_fast' || result.id === 'ship.full_suite') &&
      result.passed &&
      !result.disabled &&
      !result.skipped &&
      !result.waived &&
      result.verified_source?.fingerprint === fingerprint &&
      Boolean(result.evidence_path),
  )
  return proof?.verified_source && proof.evidence_path
    ? {
        invocation: latest.invocation_id,
        profile: proof.verified_source.profile,
        evidence: proof.evidence_path,
      }
    : null
}

/** Collect one reusable release bundle from a successful verify, without executing checks. */
export function collectReleaseEvidence(
  root: string,
  worktree: string,
  runId?: string,
): ReleaseEvidenceBundle {
  const workspace = path.resolve(root, resolveWorktreeWorkspace(root, worktree))
  const fingerprint = releaseSourceFingerprint(workspace)
  invariant(
    fingerprint !== null,
    'The candidate source fingerprint is unreadable.',
    { code: 'LANDING_VERIFICATION_REQUIRED' },
  )
  const states = runId ? [loadState(root, runId)] : listRunStates(root)
  for (const state of states) {
    const proof = currentProof(state, fingerprint)
    if (!proof) continue
    invariant(
      fileExists(resolveInside(root, proof.evidence)),
      'The verify evidence log is missing.',
      { code: 'LANDING_VERIFICATION_REQUIRED' },
    )
    const tip = gitRevParse(workspaceRepositoryRoot(root), INTEGRATION_BRANCH)
    const candidateHead = gitHead(workspace)
    invariant(candidateHead, 'The release candidate has no HEAD.', {
      code: 'LANDING_NO_HEAD',
    })
    const target = bundlePath(root, worktree)
    if (fileExists(target)) {
      const existing = readJson(target)
      if (
        isRecord(existing) &&
        existing.run_id === state.run_id &&
        existing.invocation_id === proof.invocation &&
        existing.tip === tip &&
        existing.source_fingerprint === fingerprint
      )
        return readReleaseEvidence(root, worktree)
    }
    const bundle: ReleaseEvidenceBundle = {
      schema_version: 1,
      worktree,
      run_id: state.run_id,
      invocation_id: proof.invocation,
      tip,
      source_fingerprint: fingerprint,
      profile: proof.profile,
      evidence_path: proof.evidence,
      candidate_head: candidateHead,
      collected_at: new Date().toISOString(),
    }
    writeJsonAtomic(target, bundle)
    return bundle
  }
  invariant(
    false,
    'No successful verify proves this source tree. Complete verify before collecting release evidence; release never runs tests.',
    { code: 'LANDING_VERIFICATION_REQUIRED' },
  )
}

/** Read the collected bundle; missing or stale proof requires a return to verify. */
export function readReleaseEvidence(
  root: string,
  worktree: string,
): ReleaseEvidenceBundle {
  const target = bundlePath(root, worktree)
  invariant(
    fileExists(target),
    `Collect release evidence once with pan release evidence --worktree ${worktree} before landing.`,
    { code: 'LANDING_EVIDENCE_REQUIRED' },
  )
  const value = readJson(target)
  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      value.worktree === worktree &&
      [
        'run_id',
        'invocation_id',
        'tip',
        'source_fingerprint',
        'profile',
        'evidence_path',
        'candidate_head',
        'collected_at',
      ].every((key) => typeof value[key] === 'string'),
    'The release evidence bundle is malformed.',
    { code: 'LANDING_EVIDENCE_INVALID' },
  )
  const bundle = value as unknown as ReleaseEvidenceBundle
  const workspace = path.resolve(root, resolveWorktreeWorkspace(root, worktree))
  invariant(
    bundle.tip ===
      gitRevParse(workspaceRepositoryRoot(root), INTEGRATION_BRANCH) &&
      bundle.source_fingerprint === releaseSourceFingerprint(workspace) &&
      currentProof(loadState(root, bundle.run_id), bundle.source_fingerprint)
        ?.invocation === bundle.invocation_id &&
      fileExists(resolveInside(root, bundle.evidence_path)),
    'Release evidence is stale. Synchronize the candidate and complete verify before collecting a replacement bundle.',
    { code: 'LANDING_VERIFICATION_REQUIRED' },
  )
  return bundle
}
