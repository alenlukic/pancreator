import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateReleaseOutput } from '../../src/lib/validators/stage-validators.js'
import { createFixture } from '../helpers.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'
import { validatorFixtureRoot } from './validators-stage-validators-helpers.js'

test('release validator requires structured change-list entries', () => {
  const root = validatorFixtureRoot('pan-release-change-list-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: ['src/example.ts'],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: [],
            repairs: [],
            escalations: [],
            summary: 'No issues.',
          },
          deferred_acceptance_criteria: [],
          commit_message: 'Release',
          pr_body: 'Release',
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
  })

  assert.ok(
    result.issues.some((issue) => issue.code === 'release.change_list_shape'),
  )
})

test('release rollback commands use the shared pan option grammar', () => {
  const root = validatorFixtureRoot('pan-release-rollback-command-')
  const target = 'output.json'

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [],
          rollback:
            './bin/pan governance card --mode harden --output-path card.md',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: [],
            repairs: [],
            escalations: [],
            summary: 'No issues.',
          },
          deferred_acceptance_criteria: [],
          commit_message: 'Release',
          pr_body: 'Release',
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
  })
  const rollbackIssue = result.issues.find(
    (item) => item.code === 'release.rollback_command_invalid',
  )

  assert.ok(rollbackIssue)
  assert.match(rollbackIssue.message, /--output-path/u)
  assert.match(rollbackIssue.message, /Accepted:.*--out/u)
})

test('release validator diffs the declared workspace instead of its dirty parent', () => {
  const root = validatorFixtureRoot('pan-release-worktree-')
  const workspaceRoot = path.join(root, 'declared-worktree')
  const target = 'output.json'
  const changedFile = 'src/example.ts'

  execFileSync('git', ['init'], { cwd: root })
  writeFileSync(path.join(root, 'parent.txt'), 'before\n')
  execFileSync('git', ['add', 'parent.txt'], { cwd: root })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Pancreator Tests',
      '-c',
      'user.email=tests@example.com',
      'commit',
      '-m',
      'parent baseline',
    ],
    { cwd: root },
  )
  writeFileSync(path.join(root, 'parent.txt'), 'dirty parent\n')

  mkdirSync(path.join(workspaceRoot, 'src'), { recursive: true })
  execFileSync('git', ['init'], { cwd: workspaceRoot })
  writeFileSync(
    path.join(workspaceRoot, changedFile),
    'export const value = 1\n',
  )
  execFileSync('git', ['add', changedFile], { cwd: workspaceRoot })
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Pancreator Tests',
      '-c',
      'user.email=tests@example.com',
      'commit',
      '-m',
      'workspace baseline',
    ],
    { cwd: workspaceRoot },
  )
  writeFileSync(
    path.join(workspaceRoot, changedFile),
    'export const value = 2\n',
  )

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [
            {
              path: changedFile,
              kind: 'modified',
              description: 'Updates the example value.',
            },
          ],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: [],
            repairs: [],
            escalations: [],
            summary: 'No issues.',
          },
          deferred_acceptance_criteria: [],
          commit_message: 'Release',
          pr_body: 'Release',
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: {
      workspace_root: 'declared-worktree',
    },
  })
  const issueCodes = new Set(result.issues.map((entry) => entry.code))

  assert.equal(issueCodes.has('release.change_list_shape'), false)
  assert.equal(issueCodes.has('release.change_not_in_diff'), false)
  assert.equal(issueCodes.has('release.diff_not_disclosed'), false)
})

test('release validator rejects unknown validation fingerprints', () => {
  const root = validatorFixtureRoot('pan-release-fp-')
  const target = 'output.json'
  const absolute = path.join(root, target)

  mkdirSync(root, { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [
            {
              stage: 'review',
              workspace_fingerprint: 'fp-not-in-history',
              evidence_path: 'missing/path.json',
            },
          ],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          workspace_fingerprint: 'fp-review',
        },
      ],
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.validation_fingerprint_unknown',
    ),
  )
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.validation_evidence_missing',
    ),
  )
})

test('self-development release validator requires a real next-version bump', () => {
  const root = createFixture()
  const target = 'output.json'
  const currentVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          versioning: {
            current_version: currentVersion,
            recommendation: 'patch',
            proposed_version: currentVersion,
            baseline_commit: baselineCommit,
            rationale: 'fixture',
            compatibility: 'backward compatible',
            updated_files: [
              'CHANGELOG.md',
              'README.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
            ],
            release_index_action: 'Index after the release commit exists.',
          },
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'VERSION-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: { stage_history: [] },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.proposed_version_mismatch',
    ),
  )

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          versioning: {
            current_version: '0.0.0',
            recommendation: 'patch',
            proposed_version: '0.0.1',
            baseline_commit: baselineCommit,
            rationale: '',
            compatibility: '',
            updated_files: [
              'CHANGELOG.md',
              'README.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
              'src/index.ts',
            ],
            release_index_action: '',
          },
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const historyResult = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'VERSION-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: { stage_history: [] },
  })

  assert.equal(historyResult.status, 'failed')

  for (const code of [
    'release.current_version_mismatch',
    'release.baseline_version_mismatch',
    'release.rationale_missing',
    'release.compatibility_missing',
    'release.index_action_missing',
    'release.updated_file_out_of_scope',
  ]) {
    assert.ok(
      historyResult.issues.some((issue) => issue.code === code),
      code,
    )
  }
})

test('each local-release topology branch reports its own coded issue', () => {
  // Every branch below guarded release correctness with no failing case, so
  // deleting any one of them left the suite green.
  const root = createFixture()
  const target = 'output.json'
  const validate = (localRelease: unknown) => {
    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({
        data: {
          release: {
            summary: 'ready',
            ...(localRelease === undefined
              ? {}
              : { local_release: localRelease }),
            change_list: [],
            validation: [],
            rollback: 'revert commit',
            waivers: [],
            follow_up_cases: [],
          },
        },
      })}\n`,
    )

    return validateReleaseOutput({
      root,
      targetPath: target,
      requirement: {
        policy_id: 'SHIP-001',
        requirement_id: 'release-validate',
        registry_id: 'RELEASE-VALIDATE-001',
        arguments: {},
      },
      invocation: {
        managed_worktree: {
          name: 'release',
          path: 'worktrees/operator/release',
          branch: 'main',
        },
      },
      runState: { stage_history: [] },
    }).issues.map((entry) => entry.code)
  }

  assert.ok(validate(undefined).includes('release.local_release_missing'))
  assert.ok(
    validate({
      release_commit: 'not-a-commit',
      index_commit: 'b'.repeat(40),
      fetched_main: 'c'.repeat(40),
      branch: 'main',
      pr_description_path: 'runtime/pr-descriptions/release.md',
    }).includes('release.local_release_missing'),
  )

  // Well-formed hashes that describe nothing in this workspace reach the
  // topology checks, and an untracked file makes the worktree dirty.
  writeFileSync(path.join(root, 'stray.txt'), 'left behind\n')

  const codes = validate({
    release_commit: 'a'.repeat(40),
    index_commit: 'b'.repeat(40),
    fetched_main: 'c'.repeat(40),
    branch: 'a-branch-this-workspace-is-not-on',
    pr_description_path: 'runtime/pr-descriptions/release.md',
  })

  for (const code of [
    'release.commit_order',
    'release.fetched_main_not_ancestor',
    'release.worktree_dirty',
    'release.branch_mismatch',
    'release.index_commit_scope',
  ]) {
    assert.ok(codes.includes(code), code)
  }

  assert.equal(codes.includes('release.local_release_missing'), false)
})

// int-con HR-005: `resolveInside` threw on an agent-supplied traversal, so a
// malformed release.local_release.pr_description_path ended the validator
// with a stack trace instead of an issue the retry could read.
test('a malformed pull-request description path is a coded issue, not a thrown error', () => {
  const root = createFixture()
  const target = 'output.json'
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  const validateWithPath = (prDescriptionPath: string) => {
    writeFileSync(
      path.join(root, target),
      `${JSON.stringify({
        data: {
          release: {
            summary: 'ready',
            local_release: {
              release_commit: commit,
              index_commit: commit,
              fetched_main: commit,
              branch: 'main',
              pr_description_path: prDescriptionPath,
            },
            change_list: [],
            validation: [],
            rollback: 'revert commit',
            waivers: [],
            follow_up_cases: [],
          },
        },
      })}\n`,
    )

    return validateReleaseOutput({
      root,
      targetPath: target,
      requirement: {
        policy_id: 'SHIP-001',
        requirement_id: 'release-validate',
        registry_id: 'RELEASE-VALIDATE-001',
        arguments: {},
      },
      invocation: {
        managed_worktree: {
          name: 'release',
          path: 'worktrees/operator/release',
          branch: 'main',
        },
      },
      runState: { stage_history: [] },
    })
  }

  for (const malformed of [
    '../escape.md',
    path.resolve(root, '..', 'escape.md'),
  ]) {
    const result = validateWithPath(malformed)
    const codes = result.issues.map((entry) => entry.code)

    assert.equal(result.status, 'failed', malformed)
    assert.ok(codes.includes('release.pr_description_path_invalid'), malformed)
    // The content checks have no file to judge, so neither fires.
    assert.equal(codes.includes('release.pr_description_missing'), false)
    assert.equal(codes.includes('release.pr_commit_range_missing'), false)
  }

  // A well-formed path that names no file still reaches the content check.
  const wellFormed = validateWithPath('runtime/pr-descriptions/absent.md')
  const wellFormedCodes = wellFormed.issues.map((entry) => entry.code)

  assert.equal(
    wellFormedCodes.includes('release.pr_description_path_invalid'),
    false,
  )
  assert.ok(wellFormedCodes.includes('release.pr_description_missing'))
})

test('release validator reads metadata from selected workspace', () => {
  const root = createFixture()
  const target = 'output.json'

  const currentVersion = readFileSync(path.join(root, 'VERSION'), 'utf8').trim()
  const proposedVersion = nextSemanticVersion(currentVersion, 'patch')
  const baselineCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()

  assert.ok(proposedVersion)

  const record = createWorktree(root, 'release-check')
  const worktreePath = path.join(root, record.path)

  writeFileSync(path.join(worktreePath, 'VERSION'), `${proposedVersion}\n`)
  const packagePath = path.join(worktreePath, 'package.json')
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
    version: string
  }

  packageJson.version = proposedVersion ?? ''
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

  const lockPath = path.join(worktreePath, 'package-lock.json')
  const lockJson = JSON.parse(readFileSync(lockPath, 'utf8')) as {
    version: string
    packages: Record<string, { version?: string }>
  }

  lockJson.version = proposedVersion ?? ''

  if (lockJson.packages['']) {
    lockJson.packages[''].version = proposedVersion ?? ''
  }

  writeFileSync(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`)

  writeFileSync(
    path.join(root, target),
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          versioning: {
            current_version: currentVersion,
            recommendation: 'patch',
            proposed_version: proposedVersion,
            baseline_commit: baselineCommit,
            rationale: 'Worktree release bump.',
            compatibility: 'Backward compatible.',
            updated_files: [
              'CHANGELOG.md',
              'README.md',
              'VERSION',
              'docs/embedded-installation.md',
              'package-lock.json',
              'package.json',
            ],
            release_index_action: 'Index after the release commit exists.',
          },
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'VERSION-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    runState: {
      workspace_root: record.path,
      stage_history: [],
    },
  })
  const issueCodes = new Set(result.issues.map((entry) => entry.code))

  assert.equal(issueCodes.has('release.version_not_applied'), false)
  assert.equal(issueCodes.has('release.current_version_mismatch'), false)
  assert.equal(issueCodes.has('release.baseline_version_mismatch'), false)
})

test('release validator rejects waiver fingerprint mismatch', () => {
  const root = validatorFixtureRoot('pan-release-waiver-')
  const target = 'output.json'
  const absolute = path.join(root, target)
  const artifactPath =
    'runtime/logs/workflows/run-1/artifacts/markdown/review-waiver.md'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(path.join(root, artifactPath), '# waiver\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [
            {
              waiver_id: 'waiver-review',
              workspace_fingerprint: 'fp-wrong',
            },
          ],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      workspace_before: {
        fingerprint: 'fp-actual',
      },
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          invocation_id: 'review-1',
          workspace_fingerprint: 'fp-actual',
        },
      ],
      operator_gate_waivers: [
        {
          waiver_id: 'waiver-review',
          stage: 'review',
          source_invocation_id: 'review-1',
          source_attempt: 1,
          workspace_fingerprint: 'fp-actual',
          artifact_path: artifactPath,
          source_evidence_path: artifactPath,
          criterion_ids: ['review.complete'],
          note: 'accepted risk',
          deferred_acceptance_criteria: [],
          timestamp: '2026-06-26T12:00:00.000Z',
        },
      ],
    },
  })

  assert.equal(result.status, 'failed')
  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'release.waiver_fingerprint_mismatch',
    ),
  )
})

test('release validator ignores waivers superseded by a later attempt', () => {
  const root = validatorFixtureRoot('pan-release-stale-waiver-')
  const target = 'output.json'
  const absolute = path.join(root, target)
  const artifactPath =
    'runtime/logs/workflows/run-1/artifacts/markdown/review-waiver.md'

  mkdirSync(path.dirname(path.join(root, artifactPath)), { recursive: true })
  writeFileSync(path.join(root, artifactPath), '# waiver\n')
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        release: {
          summary: 'ready',
          change_list: [],
          validation: [],
          rollback: 'revert commit',
          waivers: [],
          follow_up_cases: [],
        },
      },
    })}\n`,
  )

  const result = validateReleaseOutput({
    root,
    targetPath: target,
    requirement: {
      policy_id: 'SHIP-001',
      requirement_id: 'release-validate',
      registry_id: 'RELEASE-VALIDATE-001',
      arguments: {},
    },
    invocation: {
      workspace_before: {
        fingerprint: 'fp-current',
      },
    },
    runState: {
      stage_history: [
        {
          stage: 'review',
          invocation_id: 'review-1',
          workspace_fingerprint: 'fp-old',
        },
        {
          stage: 'review',
          invocation_id: 'review-2',
          workspace_fingerprint: 'fp-current',
        },
      ],
      operator_gate_waivers: [
        {
          waiver_id: 'waiver-review-old',
          stage: 'review',
          source_invocation_id: 'review-1',
          source_attempt: 1,
          workspace_fingerprint: 'fp-old',
          artifact_path: artifactPath,
          source_evidence_path: artifactPath,
          criterion_ids: ['review.complete'],
          note: 'superseded',
          deferred_acceptance_criteria: [],
          timestamp: '2026-06-26T12:00:00.000Z',
        },
      ],
    },
  })

  assert.ok(
    !result.issues.some((issue) => issue.code === 'release.waiver_undisclosed'),
  )
})
