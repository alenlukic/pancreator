import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import type { RunState } from '../../src/lib/types.js'
import { writeJson } from '../helpers.js'

export const COHORT_ID = '10000_Sep-02-0000_cohort-fix'

export function planFixture(): Record<string, unknown> {
  return {
    parent_spec_path: 'runtime/specs/parent-specification.md',
    chunks: [
      {
        id: 'c1',
        title: 'First outcome',
        cohort_index: 1,
        child_spec_path: 'runtime/specs/c1.md',
        depends_on: [],
      },
      {
        id: 'c2',
        title: 'Second outcome',
        cohort_index: 2,
        child_spec_path: 'runtime/specs/c2.md',
        depends_on: ['c1'],
      },
    ],
    edges: [{ from: 'c1', to: 'c2' }],
    cohorts: [
      { index: 1, chunks: ['c1'] },
      { index: 2, chunks: ['c2'] },
    ],
  }
}

export function boundRun(
  cohortIndex: number,
  chunk: string,
  cohortId = COHORT_ID,
): RunState {
  return {
    schema_version: 2,
    run_id: `chunk-${chunk}`,
    workflow_slug: 'delivery',
    workflow_snapshot: { path: 'snapshot.json', sha256: 'sha' },
    workspace_root: '.',
    cohort: { cohort_id: cohortId, cohort_index: cohortIndex, chunk },
    title: chunk,
    status: 'running',
    current_stage: 'implement',
    pending_action: { type: 'prepare_invocation' },
    current_invocation: null,
    request: { source_path: 'r.md', stored_path: 'r.md', sha256: 'sha' },
    limits: {
      max_total_transitions: 12,
      max_stage_attempts: 3,
      max_consecutive_failures: 3,
    },
    attempts: {},
    transition_count: 0,
    consecutive_failures: 0,
    stage_history: [],
    revision: 1,
    created_at: '2026-09-02T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  }
}

export function writeSpecs(root: string): void {
  mkdirSync(path.join(root, 'runtime', 'specs'), { recursive: true })

  for (const name of ['parent-specification', 'c1', 'c2']) {
    writeFileSync(
      path.join(root, 'runtime', 'specs', `${name}.md`),
      `# ${name}\n`,
    )
  }
}

/**
 * Turn the self-development fixture into a target installation. A detached
 * harness must record its target absolutely, and the fixture root stands in
 * for that target.
 */
export function setInstallationMode(
  root: string,
  mode: 'embedded' | 'detached',
): void {
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = mode

  if (mode === 'detached') {
    config.workspace_root = root
  }

  writeJson(configPath, config)
}

export const EMBEDDED_PAN = './.pancreator/bin/pan'
