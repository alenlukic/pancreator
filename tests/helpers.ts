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

import type {
  Invocation,
  RunState,
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../src/lib/types.js'

const REPO_ROOT = process.cwd()

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

  for (const entry of ['governance', 'library', '.cursor', '.pancreator']) {
    const source = path.join(REPO_ROOT, entry)

    if (existsSync(source)) {
      cpSync(source, path.join(root, entry), { recursive: true })
    }
  }

  cpSync(path.join(REPO_ROOT, 'project.json'), path.join(root, 'project.json'))

  mkdirSync(path.join(root, 'runtime', 'logs', 'orchestrator'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'logs', 'workflows'), {
    recursive: true,
  })
  mkdirSync(path.join(root, 'runtime', 'inbox'), { recursive: true })
  mkdirSync(path.join(root, 'runtime', 'backlog'), { recursive: true })
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
        version: '0.0.0',
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
          !file.includes('/validations/'),
      )
  } catch {
    return []
  }
}

function artifactMarkdown(stageSlug: string, title: string): string {
  const profileSections: Record<string, string[]> = {
    intake: ['## Approach', '## User stories', '## Constraints'],
    plan: ['## Approach', '## Architecture', '## Acceptance criteria'],
    implement: ['## Summary', '## Changes', '## Acceptance'],
    review: ['## Findings', '## Verdict'],
    test: ['## Test cases', '## Defects', '## Verdict'],
    ship: ['## Change list', '## Rollback'],
  }
  const sections = (profileSections[stageSlug] ?? ['## Summary']).join('\n\n')
  const storyLine =
    stageSlug === 'intake' ? '\n\nStory index includes US-01.\n' : ''

  return `# ${title}

**State:** Fixture stage complete.
**Outcome:** Success.
**Next action:** Submit output to the harness.

${sections}
${storyLine}
Fixture artifact body for ${stageSlug}.
`
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
      const deferred = new Set<string>()

      for (const waiver of runWaivers) {
        for (const criterion of waiver.deferred_acceptance_criteria) {
          deferred.add(criterion)
        }
      }

      return {
        release: {
          summary: 'Ready',
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
  const artifactRelative =
    `runtime/logs/workflows/${invocation.run_id}/artifacts/` +
    `${invocation.invocation_id}.md`
  const artifactAbsolute = path.join(root, artifactRelative)

  mkdirSync(path.dirname(artifactAbsolute), { recursive: true })
  writeFileSync(
    artifactAbsolute,
    artifactMarkdown(invocation.stage.slug, invocation.stage.title),
  )

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
    artifacts: [{ path: artifactRelative, description: 'Fixture artifact' }],
    criteria: stageDefinition.criteria.map((criterion) => ({
      id: criterion.id,
      result: result === 'success' ? 'pass' : 'fail',
      evidence: [artifactRelative],
      explanation: 'Fixture evidence',
    })),
    risks: [],
    unknowns: [],
    data: requiredData(invocation.stage.slug, root, invocation, runState),
  }
}
