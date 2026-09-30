import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { fixtureGit } from '../fixture-template.js'

import { renderBrief } from '../../src/lib/briefs.js'
import { nextSemanticVersion } from '../../src/lib/versioning.js'

import type {
  Invocation,
  RunState,
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../../src/lib/types.js'
import {
  finalLineOf,
  makeAttestation,
  writeEvidenceReports,
} from './attestation-helpers.js'
import { writeJson } from './fixture-helpers.js'
import { requiredData } from './required-data-helpers.js'

const UNRELEASED_HEADING = '## [Unreleased]'

export function gitChangedFiles(root: string): string[] {
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

export function prepareFixtureReleaseMetadata(root: string): {
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

    if (normalized.includes('change')) {
      return 'changes'
    }

    if (normalized.includes('accept') || normalized.includes('test')) {
      return 'validation'
    }

    if (normalized.includes('defect') || normalized.includes('constraint')) {
      return 'risks'
    }

    if (normalized.includes('rollback')) {
      return 'release'
    }

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

export function gateEvidenceCitations(
  invocation?: Invocation,
): { profile: string; fingerprint: string; evidence_path: string }[] {
  return (invocation?.inputs.references ?? []).flatMap((reference) =>
    reference.gate_evidence?.current === true
      ? [
          {
            profile: reference.gate_evidence.profile,
            fingerprint: reference.gate_evidence.fingerprint,
            evidence_path: reference.path,
          },
        ]
      : [],
  )
}

export function makeOutput(
  root: string,
  invocation: Invocation,
  stageDefinition: StageDefinition,
  result: StageOutcome = 'success',
  runState?: RunState,
): StageOutput {
  // Submission gates on the parallel evidence reports existing, so the fixture
  // output leaves them behind the way a compliant supervisor would.
  writeEvidenceReports(root, invocation)

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
