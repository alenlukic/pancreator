import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { renderBrief } from '../src/lib/briefs.js'
import { syncCursorProjection } from '../src/lib/projection.js'
import { nextSemanticVersion } from '../src/lib/versioning.js'

import type {
  Invocation,
  RunState,
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../src/lib/types.js'

const REPO_ROOT = process.cwd()
const CURRENT_VERSION = readFileSync(
  path.join(REPO_ROOT, 'VERSION'),
  'utf8',
).trim()

const FIXTURE_GIT_TIMEOUT_MS = 30_000
const FIXTURE_GIT_MAX_BUFFER = 1_024 * 1_024

function fixtureGit(
  args: string[],
  options: { cwd: string; encoding: 'utf8' },
): string {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: options.encoding,
    timeout: FIXTURE_GIT_TIMEOUT_MS,
    maxBuffer: FIXTURE_GIT_MAX_BUFFER,
  })
}

export function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-v2-'))

  for (const entry of [
    'governance',
    'library',
    'release',
    'docs',
    '.pancreator',
  ]) {
    const source = path.join(REPO_ROOT, entry)

    if (existsSync(source)) {
      cpSync(source, path.join(root, entry), { recursive: true })
    }
  }

  for (const entry of [
    'CHANGELOG.md',
    'README.md',
    'VERSION',
    'package-lock.json',
    'project.json',
    '.gitignore',
  ]) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry))
  }

  mkdirSync(path.join(root, 'runtime', 'logs', 'orchestrator'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'logs', 'workflows'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'inbox'), { recursive: true })
  mkdirSync(path.join(root, 'runtime', 'backlog'), { recursive: true })
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })

  writeFileSync(path.join(root, 'AGENTS.md'), '# fixture\n')
  writeFileSync(
    path.join(root, 'request.md'),
    'Build a dependency-free workflow harness.\n',
  )
  writeFileSync(path.join(root, 'src', 'base.ts'), 'export const base = true\n')
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'pancreator-v2-prototype',
        version: CURRENT_VERSION,
        private: true,
        type: 'module',
        scripts: {
          lint: 'node -e "process.exit(0)"',
          test: 'node -e "process.exit(0)"',
          'test:coverage': 'node -e "process.exit(0)"',
          validate: 'node -e "process.exit(0)"',
        },
      },
      null,
      2,
    ),
  )

  syncCursorProjection(root, { write: true })

  fixtureGit(['init', '-q'], { cwd: root, encoding: 'utf8' })
  fixtureGit(['config', 'user.email', 'fixture@example.com'], {
    cwd: root,
    encoding: 'utf8',
  })
  fixtureGit(['config', 'user.name', 'Fixture'], {
    cwd: root,
    encoding: 'utf8',
  })
  fixtureGit(['add', '.'], { cwd: root, encoding: 'utf8' })
  fixtureGit(['commit', '-qm', 'fixture'], { cwd: root, encoding: 'utf8' })

  return root
}

export function read(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, 'utf8')) as unknown
}

export function writeJson(pathname: string, value: unknown): void {
  mkdirSync(path.dirname(pathname), { recursive: true })
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`)
}

function gitChangedFiles(root: string): string[] {
  if (!existsSync(path.join(root, '.git'))) {
    return []
  }

  try {
    const tracked = fixtureGit(
      ['diff', '--name-only', 'HEAD', '--diff-filter=ACMR'],
      { cwd: root, encoding: 'utf8' },
    ).trim()
    const untracked = fixtureGit(
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8' },
    ).trim()

    return [...tracked.split('\n'), ...untracked.split('\n')]
      .filter(Boolean)
      .filter(
        (file) =>
          !file.startsWith('runtime/') &&
          !file.endsWith('/.lock') &&
          !file.endsWith('/.operation-mutex') &&
          !file.includes('/validations/'),
      )
  } catch {
    return []
  }
}

function prepareFixtureReleaseMetadata(root: string): {
  currentVersion: string
  proposedVersion: string
  baselineCommit: string
  updatedFiles: string[]
} {
  const currentVersion = fixtureGit(['show', 'HEAD:VERSION'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const baselineCommit = fixtureGit(['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  const versionPath = path.join(root, 'VERSION')
  const workingVersion = readFileSync(versionPath, 'utf8').trim()
  const changelogPath = path.join(root, 'CHANGELOG.md')
  const changelog = readFileSync(changelogPath, 'utf8')
  const latestVersion = /^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/mu.exec(
    changelog,
  )?.[1]
  const existingCandidate =
    workingVersion !== currentVersion && latestVersion === workingVersion
  const proposedVersion = existingCandidate
    ? workingVersion
    : (nextSemanticVersion(currentVersion, 'patch') ?? currentVersion)

  writeFileSync(versionPath, `${proposedVersion}\n`)

  for (const filename of ['package.json', 'package-lock.json']) {
    const filePath = path.join(root, filename)
    const value = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >

    value.version = proposedVersion

    if (filename === 'package-lock.json') {
      const packages = value.packages as Record<string, Record<string, unknown>>

      if (packages?.['']) {
        packages[''].version = proposedVersion
      }
    }

    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
  }

  if (!existingCandidate) {
    const releaseEntry =
      `## [${proposedVersion}] - 2026-06-30\n\n` +
      '### Changed\n\n' +
      '- Prepare fixture release metadata.\n'
    const updatedChangelog = changelog.includes('## [Unreleased]')
      ? changelog.replace('## [Unreleased]', releaseEntry.trimEnd())
      : changelog.replace('# Changelog\n', `# Changelog\n\n${releaseEntry}`)

    writeFileSync(changelogPath, updatedChangelog)
  }

  const readmePath = path.join(root, 'README.md')
  const readme = readFileSync(readmePath, 'utf8')

  writeFileSync(
    readmePath,
    readme.replaceAll(
      `Pancreator v${currentVersion}`,
      `Pancreator v${proposedVersion}`,
    ),
  )

  const embeddedPath = path.join(root, 'docs', 'embedded-installation.md')
  const embedded = readFileSync(embeddedPath, 'utf8')

  writeFileSync(
    embeddedPath,
    embedded.replace(
      `currently agree on \`${currentVersion}\``,
      `currently agree on \`${proposedVersion}\``,
    ),
  )

  return {
    currentVersion,
    proposedVersion,
    baselineCommit,
    updatedFiles: [
      'CHANGELOG.md',
      'README.md',
      'VERSION',
      'docs/embedded-installation.md',
      'package-lock.json',
      'package.json',
    ],
  }
}

function artifactBrief(
  stageSlug: string,
  title: string,
): Record<string, unknown> {
  const profileSections: Record<string, string[]> = {
    intake: ['Approach', 'User stories', 'Constraints'],
    plan: ['Approach', 'Architecture', 'Acceptance criteria'],
    implement: ['Changes', 'Acceptance'],
    review: ['Findings', 'Verdict'],
    test: ['Test cases', 'Defects', 'Verdict'],
    ship: ['Change list', 'Rollback'],
    inspect: ['Findings', 'Verdict'],
  }
  const semanticForHeading = (heading: string): string => {
    const normalized = heading.toLowerCase()

    if (normalized.includes('change')) return 'changes'
    if (normalized.includes('accept') || normalized.includes('test')) {
      return 'validation'
    }
    if (normalized.includes('defect') || normalized.includes('constraint')) {
      return 'risks'
    }
    if (normalized.includes('rollback')) return 'release'

    return 'context'
  }
  const bodyForHeading = (heading: string): string =>
    heading === 'User stories'
      ? 'US-01 — Run a workflow and observe the expected outcome.'
      : `Fixture ${heading.toLowerCase()} details for ${stageSlug}.`

  return {
    schema_version: 1,
    brief_type: stageSlug === 'ship' ? 'release' : 'workflow-run',
    title,
    subtitle: `Fixture operator brief for ${stageSlug}.`,
    sections: [
      {
        semantic: 'executive-summary',
        title: 'Executive summary',
        cards: [
          {
            type: 'summary',
            title: `${title} complete`,
            body:
              'The fixture stage completed successfully with concrete evidence. ' +
              'The next action is to submit the stage output to the harness.',
          },
        ],
      },
      ...(profileSections[stageSlug] ?? ['Changes', 'Acceptance']).map(
        (heading) => ({
          semantic: semanticForHeading(heading),
          title: heading,
          cards: [
            {
              type: 'summary',
              title: heading,
              body: bodyForHeading(heading),
            },
          ],
        }),
      ),
    ],
  }
}

function requiredData(
  stage: string,
  root?: string,
  invocation?: Invocation,
  runState?: RunState,
): Record<string, unknown> {
  switch (stage) {
    case 'intake':
      return {
        product_spec: {
          summary: 'A harness',
          user_stories: [{ id: 'US-01', statement: 'Run a workflow' }],
          constraints: ['No runtime dependencies'],
          out_of_scope: ['Remote services'],
          open_questions: [],
        },
      }
    case 'plan':
      return {
        engineering_plan: {
          approach: 'Use files and a state machine',
          components: ['engine'],
          files: [
            {
              path: 'src/base.ts',
              status: 'modified',
              purpose: 'Workflow engine',
            },
          ],
          risks: [],
          validation: ['tests'],
        },
        acceptance_criteria: [
          {
            id: 'AC-01',
            criterion: 'Workflow advances',
            maps_to: ['US-01'],
            verification: {
              method: 'integration test',
              expected: 'Workflow reaches ship',
            },
          },
        ],
      }
    case 'implement':
      return {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: ['fixture'],
          ...(invocation && invocation.attempt > 1
            ? {
                remediation: [
                  {
                    cause: 'Prior stage attempt failed.',
                    action: 'Address the recorded failure before resubmission.',
                    evidence: ['fixture remediation evidence'],
                  },
                ],
              }
            : {}),
        },
        acceptance_results: [
          {
            id: 'AC-01',
            result: 'pass',
            evidence: ['tests/integration/dev-workflow.test.ts'],
          },
        ],
      }
    case 'review':
      return {
        review: {
          verdict: 'pass',
          findings: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: ['fixture'],
            },
          ],
          maintenance_assessment: 'Proportionate',
        },
      }
    case 'test':
      return {
        test: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-1',
              steps: 'Run workflow fixture',
              expected: 'advance',
              actual: 'advance',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: ['fixture'],
            },
          ],
        },
      }
    case 'inspect':
      return { inspection: { findings: [], verdict: 'pass' } }
    case 'ship': {
      const fingerprint =
        invocation?.workspace_before.fingerprint ?? 'fixture-fingerprint'
      const stageHistory = Array.isArray(runState?.stage_history)
        ? runState.stage_history
        : []
      const historyFingerprints = new Map<string, string>()

      for (const item of stageHistory) {
        historyFingerprints.set(item.stage, item.workspace_fingerprint)
      }

      const runWaivers = Array.isArray(runState?.operator_gate_waivers)
        ? runState.operator_gate_waivers
        : []
      const governanceIssues = Array.isArray(
        runState?.governance_artifact_issues,
      )
        ? runState.governance_artifact_issues
        : []
      const deferred = new Set<string>()

      for (const waiver of runWaivers) {
        for (const criterion of waiver.deferred_acceptance_criteria) {
          deferred.add(criterion)
        }
      }

      const projectConfig = root
        ? (JSON.parse(
            readFileSync(path.join(root, 'project.json'), 'utf8'),
          ) as { installation_mode?: string })
        : null
      const fixtureRelease =
        projectConfig?.installation_mode === 'self_development' && root
          ? prepareFixtureReleaseMetadata(root)
          : null
      const versioning = fixtureRelease
        ? {
            versioning: {
              current_version: fixtureRelease.currentVersion,
              recommendation: 'patch',
              proposed_version: fixtureRelease.proposedVersion,
              baseline_commit: fixtureRelease.baselineCommit,
              rationale:
                'Fixture release contains backward-compatible maintenance changes.',
              compatibility: 'Backward compatible.',
              updated_files: fixtureRelease.updatedFiles,
              release_index_action:
                'Create the release commit first, then add its hash in a separate index metadata commit.',
            },
          }
        : {}

      return {
        release: {
          summary: 'Ready',
          ...versioning,
          change_list: root ? gitChangedFiles(root) : [],
          validation: [
            {
              stage: 'review',
              workspace_fingerprint:
                historyFingerprints.get('review') ?? fingerprint,
              evidence_path: 'src/base.ts',
            },
            {
              stage: 'test',
              workspace_fingerprint:
                historyFingerprints.get('test') ?? fingerprint,
              evidence_path: 'src/base.ts',
            },
          ],
          rollback: 'Revert changes',
          waivers: runWaivers.map((waiver) => ({
            waiver_id: waiver.waiver_id,
            workspace_fingerprint: waiver.workspace_fingerprint,
          })),
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: governanceIssues.map((issue) => issue.issue_id),
            repairs: [],
            escalations: [],
            summary:
              governanceIssues.length > 0
                ? 'All recorded governance and artifact issues were reviewed.'
                : 'No unresolved governance or artifact issues.',
          },
          deferred_acceptance_criteria: [...deferred],
          commit_message: 'Build harness',
          pr_body: 'Prototype',
        },
      }
    }
    default:
      throw new Error(`Unknown stage ${stage}`)
  }
}

export function writeCanonicalDelegation(
  root: string,
  invocation: Invocation,
): void {
  const markdownRelative =
    `runtime/logs/workflows/${invocation.run_id}/invocations/` +
    `${invocation.invocation_id}.md`
  const delegationRelative =
    `runtime/logs/workflows/${invocation.run_id}/invocations/` +
    `${invocation.invocation_id}.delegation.md`
  const markdownAbsolute = path.join(root, markdownRelative)
  const delegationAbsolute = path.join(root, delegationRelative)

  mkdirSync(path.dirname(delegationAbsolute), { recursive: true })
  writeFileSync(delegationAbsolute, readFileSync(markdownAbsolute, 'utf8'))
}

export function makeOutput(
  root: string,
  invocation: Invocation,
  stageDefinition: StageDefinition,
  result: StageOutcome = 'success',
  runState?: RunState,
): StageOutput {
  const briefSource = invocation.output.operator_brief.source_path
  const briefHtml = invocation.output.operator_brief.rendered_path

  writeJson(
    path.join(root, briefSource),
    artifactBrief(invocation.stage.slug, invocation.stage.title),
  )
  renderBrief(root, briefSource, briefHtml)

  return {
    $operator: {
      headline: `${invocation.stage.title} done`,
      status: result,
      next_action: 'Submit',
    },
    schema_version: 1,
    invocation_id: invocation.invocation_id,
    result,
    summary: `${invocation.stage.title} completed in fixture.`,
    artifacts: [
      { path: briefHtml, description: 'Fixture HTML operator brief' },
      { path: briefSource, description: 'Fixture operator brief source' },
    ],
    criteria: stageDefinition.criteria.map((criterion) => ({
      id: criterion.id,
      result: result === 'success' ? 'pass' : 'fail',
      evidence: [briefHtml],
      explanation: 'Fixture evidence',
    })),
    risks: [],
    unknowns: [],
    data: requiredData(invocation.stage.slug, root, invocation, runState),
  }
}
