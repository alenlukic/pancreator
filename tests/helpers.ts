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
import { readHarnessConfig } from '../src/lib/project-config.js'
import { syncCursorProjection } from '../src/lib/projection.js'
import { resolveRunLayout } from '../src/lib/run-layout.js'
import { nextSemanticVersion } from '../src/lib/versioning.js'

import type {
  Invocation,
  InvocationAttestation,
  RunState,
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../src/lib/types.js'

const REPO_ROOT = process.cwd()
const UNRELEASED_HEADING = '## [Unreleased]'
const CURRENT_VERSION = readFileSync(
  path.join(REPO_ROOT, 'VERSION'),
  'utf8',
).trim()

// The suite runs one fixture per test file in parallel, so fixture setup shares
// the machine with every other suite. The limit guards against a hung Git
// process, not against a slow one.
const FIXTURE_GIT_TIMEOUT_MS = 180_000
const FIXTURE_GIT_MAX_BUFFER = 1_024 * 1_024
const FIXTURE_INVOLVEMENT_PROFILE = 'standard'

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

/**
 * Pin the involvement profile a fixture run resolves.
 *
 * A fixture copies the repository configuration, so the checked-in operator
 * preference would otherwise decide which stages stop for approval in every
 * workflow test. Tests that need another profile select it explicitly.
 */
function pinFixtureInvolvement(root: string): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    operator_involvement?: { active?: string }
  }

  if (!config.operator_involvement) {
    return
  }

  config.operator_involvement.active = FIXTURE_INVOLVEMENT_PROFILE

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
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
    '.gitignore',
  ]) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry))
  }

  // The checked-in config.json intentionally blanks its model values; the
  // real specs live in the untracked config_overrides.json. Fixtures need a
  // complete standalone config, so they receive this checkout's effective
  // merged configuration.
  writeFileSync(
    path.join(root, 'config.json'),
    `${JSON.stringify(
      readHarnessConfig(REPO_ROOT, path.join(REPO_ROOT, 'config.json')),
      null,
      2,
    )}\n`,
  )

  pinFixtureInvolvement(root)

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

  writeFileSync(
    path.join(root, 'AGENTS.md'),
    [
      '# fixture',
      '',
      'Ad-hoc Subagent calls MUST omit `model` so they inherit the parent model unless the operator explicitly selects a model.',
      'Named personas retain their projected model routing through projected frontmatter and `config.json`.',
      '',
    ].join('\n'),
  )
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
    // Anchor to a line-start heading: a prose mention of the literal
    // `## [Unreleased]` inside a release bullet must not match once the real
    // section is gone, or the fixture release gets spliced mid-bullet.
    const unreleasedStart = changelog.search(/^## \[Unreleased\]/mu)
    let updatedChangelog: string

    if (unreleasedStart === -1) {
      updatedChangelog = changelog.replace(
        '# Changelog\n',
        `# Changelog\n\n${releaseEntry}`,
      )
    } else {
      // Consume the whole Unreleased section, the way a real release does.
      // Replacing only its heading would leave its group headings behind, merge
      // them into the fixture release, and trip the Changed/Added/Removed/Fixed
      // ordering rule in validateChangelog.
      const nextRelease = changelog.indexOf(
        '\n## ',
        unreleasedStart + UNRELEASED_HEADING.length,
      )
      const tail = nextRelease === -1 ? '' : changelog.slice(nextRelease + 1)

      updatedChangelog =
        changelog.slice(0, unreleasedStart) +
        releaseEntry +
        (tail === '' ? '' : `\n${tail}`)
    }

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
  requiredHeadings?: string[],
): Record<string, unknown> {
  // Section titles come from the invocation's own brief contract when available.
  // Keying them by stage slug alone breaks as soon as two workflows share a slug
  // with different brief profiles, as `dev/intake` and `prototype/intake` do.
  const profileSections: Record<string, string[]> = {
    intake: ['Approach', 'User stories', 'Constraints'],
    plan: ['Approach', 'Architecture', 'Acceptance criteria'],
    implement: ['Changes', 'Acceptance'],
    review: ['Findings', 'Verdict'],
    test: ['Test cases', 'Defects', 'Verdict'],
    ship: ['Change list', 'Rollback'],
    inspect: ['Findings', 'Verdict'],
  }
  const capitalize = (value: string): string =>
    value.charAt(0).toUpperCase() + value.slice(1)
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
      ...(requiredHeadings && requiredHeadings.length > 0
        ? requiredHeadings.map(capitalize)
        : (profileSections[stageSlug] ?? ['Changes', 'Acceptance'])
      ).map((heading) => ({
        semantic: semanticForHeading(heading),
        title: heading,
        cards: [
          {
            type: 'summary',
            title: heading,
            body: bodyForHeading(heading),
          },
        ],
      })),
    ],
  }
}

function requiredData(
  stage: string,
  root?: string,
  invocation?: Invocation,
  runState?: RunState,
  workflowSlug?: string,
): Record<string, unknown> {
  if (workflowSlug === 'prototype') {
    switch (stage) {
      case 'intake':
        return {
          prototype_brief: {
            objective: 'Test whether one adapter covers both providers.',
            technical_questions: [
              {
                id: 'TQ-01',
                question: 'Does one adapter interface cover both providers?',
              },
            ],
            success_signals: [
              {
                question_id: 'TQ-01',
                signal: 'Both providers respond through the adapter.',
              },
            ],
            acceptable_shortcuts: ['Hard-coded credentials'],
            out_of_scope: ['Migration and hardening'],
          },
        }
      case 'approach':
        return {
          technical_approach: {
            hypothesis: 'One adapter interface is sufficient.',
            strategy: 'Add a thin adapter and route both providers through it.',
            touch_points: ['src/adapter.ts'],
            planned_shortcuts: ['Skip retry handling'],
            observable_signals: [
              { question_id: 'TQ-01', signal: 'Both providers respond.' },
            ],
            discard_conditions: [
              'Either provider needs caller-visible config.',
            ],
          },
        }
      case 'build':
        return {
          spike: {
            changed_files: [],
            shortcuts_taken: [
              {
                shortcut: 'Skipped retry handling',
                reason: 'Not needed to answer the question.',
              },
            ],
            signal_evidence: [
              {
                signal: 'Both providers respond.',
                observed: 'Both returned a completion.',
              },
            ],
            notes: ['fixture spike'],
          },
        }
      case 'evaluate':
        return {
          evaluation: {
            verdict: 'validated',
            question_results: [
              {
                question_id: 'TQ-01',
                result: 'answered',
                evidence: ['fixture'],
              },
            ],
            signal_assessment: [
              { signal: 'Both providers respond.', measures_question: true },
            ],
            productionization_gap: ['Restore retry handling'],
            recommendation: 'Productionize through a systematic dev run.',
            discard_candidates: ['hard-coded credentials'],
          },
        }
      default:
        throw new Error(`Unknown prototype stage ${stage}`)
    }
  }

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
        open_question_dispositions: [],
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
    case 'consolidate':
      return {
        consolidation: {
          candidates: [
            {
              run_id: 'fixture-candidate',
              verdict: 'adopted',
              strengths: ['Smallest change'],
              weaknesses: ['Thin tests'],
              taken: 'Its adapter boundary',
            },
          ],
          strategy: 'Adopt one candidate and add the missing tests.',
        },
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: ['fixture'],
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
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture'] },
        ],
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
        ? (JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8')) as {
            installation_mode?: string
          })
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
          change_list: root
            ? gitChangedFiles(root).map((changedPath) => ({
                path: changedPath,
                kind: 'modified',
                description: 'Fixture workspace change.',
              }))
            : [],
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

/**
 * Persist the delegation evidence a compliant supervisor would leave: the exact
 * body the invocation names, which is the compact delivery prompt under
 * referenced delivery and the canonical card under verbatim delivery.
 */
export function writeCanonicalDelegation(
  root: string,
  invocation: Invocation,
): void {
  const layout = resolveRunLayout(root, invocation.run_id)
  const deliveredRelative =
    invocation.delegation?.mode === 'referenced' &&
    invocation.delegation.delivery_prompt_path
      ? invocation.delegation.delivery_prompt_path
      : (invocation.delegation?.canonical_markdown_path ??
        layout.invocation(invocation.invocation_id, '.md').relative)
  const delegationAbsolute = layout.invocation(
    invocation.invocation_id,
    '.delegation.md',
  ).absolute

  mkdirSync(path.dirname(delegationAbsolute), { recursive: true })
  writeFileSync(
    delegationAbsolute,
    readFileSync(path.join(root, deliveredRelative), 'utf8'),
  )
}

/** Verbatim last non-empty line of a text, or '' when none exists. */
function finalLineOf(content: string): string {
  const lines = content.split('\n')

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim().length > 0) {
      return lines[index]
    }
  }

  return ''
}

/** The final-line read evidence a worker owes for one guidance selection. */
function guidanceFinalLine(
  invocation: Invocation,
  entry: { policy_id: string; source_path: string },
): string {
  for (const policies of [
    invocation.policies,
    invocation.delegation?.policies ?? [],
  ]) {
    for (const policy of policies) {
      if (policy.id !== entry.policy_id) {
        continue
      }

      for (const guidance of policy.guidance ?? []) {
        if (guidance.source_path === entry.source_path) {
          return finalLineOf(guidance.content)
        }
      }
    }
  }

  return ''
}

/**
 * Attach compliant per-file read evidence for the given instruction paths,
 * quoting each file's actual last non-empty line from the fixture tree.
 */
export function attachTargetInstructionEvidence(
  root: string,
  output: StageOutput,
  readPaths: string[],
): void {
  output.target_instruction_evidence = {
    read_paths: readPaths,
    reads: readPaths.map((readPath) => ({
      path: readPath,
      final_line: finalLineOf(readFileSync(path.join(root, readPath), 'utf8')),
    })),
  }
}

/** The read attestation a worker owes for a referenced invocation contract. */
export function makeAttestation(
  invocation: Invocation,
): InvocationAttestation | undefined {
  const manifest = invocation.contract_manifest

  if (!manifest) {
    return undefined
  }

  return {
    invocation_id: invocation.invocation_id,
    model: invocation.stage.model,
    contract_path: manifest.contract_path,
    contract_sha256: manifest.contract_sha256,
    status: 'read',
    sections: manifest.sections.map((section) => ({
      id: section.id,
      sha256: section.sha256,
    })),
    ...(manifest.guidance?.length
      ? {
          guidance: manifest.guidance.map((entry) => ({
            policy_id: entry.policy_id,
            source_path: entry.source_path,
            content_sha256: entry.content_sha256,
            status: 'read' as const,
            final_line: guidanceFinalLine(invocation, entry),
          })),
        }
      : {}),
  }
}

export function makeOutput(
  root: string,
  invocation: Invocation,
  stageDefinition: StageDefinition,
  result: StageOutcome = 'success',
  runState?: RunState,
): StageOutput {
  const briefContract = invocation.output.operator_brief
  let artifacts: StageOutput['artifacts'] = []

  if (briefContract) {
    const briefSource = briefContract.source_path
    const briefHtml = briefContract.rendered_path

    writeJson(
      path.join(root, briefSource),
      artifactBrief(
        invocation.stage.slug,
        invocation.stage.title,
        briefContract.required_headings,
      ),
    )
    renderBrief(root, briefSource, briefHtml)

    artifacts = [
      { path: briefHtml, description: 'Fixture HTML operator brief' },
      ...(briefContract.source_lifecycle === 'transient' ||
      briefContract.source_transient
        ? []
        : [
            { path: briefSource, description: 'Fixture operator brief source' },
          ]),
    ]
  }

  if (invocation.output.artifacts) {
    const prContext = invocation.inputs.pr_description

    for (const artifact of invocation.output.artifacts) {
      if (artifact.path === briefContract?.rendered_path) {
        continue
      }

      const body =
        prContext?.mode === 'target'
          ? prContext.required_headings
              .map(
                (heading) =>
                  `## ${heading}\n\nFixture content for ${heading}.\n`,
              )
              .join('\n')
          : 'test: fixture PR body\n\n## Summary\n\nFixture summary.\n\n## Changelist\n\n- Fixture change.\n'

      writeFileSync(path.join(root, artifact.path), body)
    }

    artifacts = invocation.output.artifacts
  }

  const attestation = makeAttestation(invocation)

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
    artifacts,
    criteria: stageDefinition.criteria.map((criterion) => ({
      id: criterion.id,
      result: result === 'success' ? 'pass' : 'fail',
      evidence: [briefContract?.rendered_path ?? invocation.output.path],
      explanation: 'Fixture evidence',
    })),
    risks: [],
    unknowns: [],
    data: requiredData(
      invocation.stage.slug,
      root,
      invocation,
      runState,
      invocation.workflow.slug,
    ),
    ...(invocation.inputs.target_instructions
      ? {
          target_instruction_evidence: {
            read_paths: invocation.inputs.target_instructions.read_paths,
            reads: invocation.inputs.target_instructions.read_paths.map(
              (readPath) => {
                const workspaceRoot = path.resolve(
                  root,
                  runState?.workspace_root ?? '.',
                )
                const absolute = path.join(workspaceRoot, readPath)

                return {
                  path: readPath,
                  final_line: existsSync(absolute)
                    ? finalLineOf(readFileSync(absolute, 'utf8'))
                    : 'missing instruction file',
                }
              },
            ),
          },
        }
      : {}),
    ...(attestation ? { invocation_attestation: attestation } : {}),
  }
}
