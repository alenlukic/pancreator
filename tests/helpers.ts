import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  Invocation,
  StageDefinition,
  StageOutcome,
  StageOutput,
} from '../src/lib/types.js'

const REPO_ROOT = process.cwd()

export function createFixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'pancreator-v2-'))

  for (const entry of ['governance', 'library', '.cursor', '.pancreator']) {
    cpSync(path.join(REPO_ROOT, entry), path.join(root, entry), {
      recursive: true,
    })
  }

  cpSync(
    path.join(REPO_ROOT, 'pipeline.config.json'),
    path.join(root, 'pipeline.config.json'),
  )

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

  execFileSync('git', ['init', '-q'], { cwd: root })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: root,
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: root })
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root })

  return root
}

export function read(pathname: string): unknown {
  return JSON.parse(readFileSync(pathname, 'utf8')) as unknown
}

export function writeJson(pathname: string, value: unknown): void {
  mkdirSync(path.dirname(pathname), { recursive: true })
  writeFileSync(pathname, `${JSON.stringify(value, null, 2)}\n`)
}

function requiredData(stage: string): Record<string, unknown> {
  switch (stage) {
    case 'intake':
      return {
        product_spec: {
          summary: 'A harness',
          user_stories: [{ id: 'US-1', statement: 'Run a workflow' }],
          constraints: ['No runtime dependencies'],
          out_of_scope: [],
          open_questions: [],
        },
      }
    case 'plan':
      return {
        engineering_plan: {
          approach: 'Use files and a state machine',
          components: ['engine'],
          files: ['src/lib/engine.ts'],
          risks: [],
          validation: ['tests'],
        },
        acceptance_criteria: [
          {
            id: 'AC-1',
            statement: 'Workflow advances',
            story_ids: ['US-1'],
            verification: 'integration test',
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
          { id: 'AC-1', result: 'pass', evidence: ['fixture'] },
        ],
      }
    case 'review':
      return {
        review: {
          verdict: 'pass',
          findings: [],
          acceptance_results: [{ id: 'AC-1', result: 'pass' }],
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
              expected: 'advance',
              actual: 'advance',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [{ id: 'AC-1', result: 'pass' }],
        },
      }
    case 'inspect':
      return { inspection: { findings: [], verdict: 'pass' } }
    case 'ship':
      return {
        release: {
          summary: 'Ready',
          change_list: [],
          validation: ['review', 'test'],
          rollback: 'Revert changes',
          commit_message: 'Build harness',
          pr_body: 'Prototype',
        },
      }
    default:
      throw new Error(`Unknown stage ${stage}`)
  }
}

export function makeOutput(
  root: string,
  invocation: Invocation,
  stageDefinition: StageDefinition,
  result: StageOutcome = 'success',
): StageOutput {
  const artifactRelative =
    `runtime/logs/workflows/${invocation.run_id}/artifacts/` +
    `${invocation.invocation_id}.md`
  const artifactAbsolute = path.join(root, artifactRelative)

  mkdirSync(path.dirname(artifactAbsolute), { recursive: true })
  writeFileSync(artifactAbsolute, `# ${invocation.stage.title}\n`)

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
    data: requiredData(invocation.stage.slug),
  }
}
