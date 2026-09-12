import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { findAdoptableRepositoryCheckBaseline } from '../../src/lib/engine.js'
import { createTestTempDirectory } from '../temp.js'

const FINGERPRINT = 'a'.repeat(64)
const DIGEST = 'b'.repeat(64)

/** A recorded passing baseline artifact, before any field is spoiled. */
function baselineArtifact(): Record<string, unknown> {
  return {
    schema_version: 1,
    run_id: 'run-1',
    stage: 'implement',
    profile: 'static',
    workspace_fingerprint: FINGERPRINT,
    checks_config_sha256: DIGEST,
    recorded_at: '2026-09-12T08:00:00.000Z',
    result: {
      profile: 'static',
      status: 'passed',
      config_path: 'runtime/repository-checks.json',
      workspace_root: '.',
      timeout_ms: 60_000,
      results: [
        {
          kind: 'command',
          command: 'npm run lint',
          exit_code: 0,
          signal: null,
          stdout: '',
          stderr: '',
          passed: true,
          timed_out: false,
          duration_ms: 6_000,
        },
      ],
      total_duration_ms: 6_000,
      advisories: [],
    },
  }
}

/**
 * Write one cohort-scoped baseline artifact and return the root holding it.
 * `body` is written verbatim when it is a string, which is how an unreadable
 * artifact is staged.
 */
function rootWithBaseline(body: Record<string, unknown> | string): string {
  const root = createTestTempDirectory('baseline-reuse-')
  const directory = path.join(
    root,
    'runtime',
    'logs',
    'cohorts',
    'cohort-1',
    'baselines',
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'pre-implementation-static.json'),
    typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`,
  )

  return root
}

function adoptable(
  root: string,
): ReturnType<typeof findAdoptableRepositoryCheckBaseline> {
  return findAdoptableRepositoryCheckBaseline(
    root,
    'static',
    FINGERPRINT,
    DIGEST,
  )
}

test('a passing baseline at the same fingerprint and configuration is adoptable', () => {
  // The profile's answer is a function of the tree and the configuration. A
  // second run of the same unit of work re-derives an answer it already has.
  const adopted = adoptable(rootWithBaseline(baselineArtifact()))

  assert.ok(adopted)
  assert.equal(
    adopted.artifact_path,
    'runtime/logs/cohorts/cohort-1/baselines/pre-implementation-static.json',
  )
  assert.equal(adopted.recorded_at, '2026-09-12T08:00:00.000Z')
})

test('the most recently recorded matching baseline wins', () => {
  const root = rootWithBaseline(baselineArtifact())
  const newer = {
    ...baselineArtifact(),
    recorded_at: '2026-09-12T09:00:00.000Z',
  }
  const directory = path.join(
    root,
    'runtime',
    'logs',
    'cohorts',
    'cohort-2',
    'baselines',
  )

  mkdirSync(directory, { recursive: true })
  writeFileSync(
    path.join(directory, 'pre-implementation-static.json'),
    `${JSON.stringify(newer, null, 2)}\n`,
  )

  assert.equal(
    adoptable(root)?.artifact_path,
    'runtime/logs/cohorts/cohort-2/baselines/pre-implementation-static.json',
  )
})

test('a baseline that does not describe this tree and configuration is a miss', () => {
  // Adoption replaces an execution, so every reason the recorded answer might
  // not be this workspace's answer has to read as a miss and fall back to
  // capturing. A miss is silent: it is the normal path, not an error.
  const spoiled: Record<string, Record<string, unknown> | string> = {
    'a different tree': {
      ...baselineArtifact(),
      workspace_fingerprint: 'c'.repeat(64),
    },
    'a different verification configuration': {
      ...baselineArtifact(),
      checks_config_sha256: 'd'.repeat(64),
    },
    'no recorded configuration digest': (() => {
      const artifact = baselineArtifact()

      delete artifact.checks_config_sha256

      return artifact
    })(),
    'a profile that did not pass': {
      ...baselineArtifact(),
      result: { ...(baselineArtifact().result as object), status: 'failed' },
    },
    'an unreadable artifact': '{ not json',
    'a missing full-result companion': {
      ...baselineArtifact(),
      full_result_path:
        'runtime/logs/cohorts/cohort-1/baselines/pre-implementation-static.full.json',
    },
  }

  for (const [reason, body] of Object.entries(spoiled)) {
    assert.equal(adoptable(rootWithBaseline(body)), null, reason)
  }
})

test('a workspace with no recorded baseline is a miss', () => {
  assert.equal(adoptable(createTestTempDirectory('baseline-empty-')), null)
})
