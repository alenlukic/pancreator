import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { StageDefinition } from '../../src/lib/types.js'
import { writeJson } from '../helpers.js'

/** Preserve entry-gate compatibility coverage without changing current workflows. */
export function installLegacyReleaseEntry(root: string): void {
  const base = path.join(root, 'library/workflows/delivery/stages')
  const verifyPath = path.join(base, 'verify.json')
  const shipPath = path.join(base, 'ship.json')
  const verify = JSON.parse(readFileSync(verifyPath, 'utf8')) as StageDefinition
  const ship = JSON.parse(readFileSync(shipPath, 'utf8')) as StageDefinition
  const checks = verify.criteria.filter(
    (criterion) => criterion.type === 'shell',
  )

  verify.criteria = verify.criteria.filter(
    (criterion) => criterion.type !== 'shell',
  )
  // Replay generic entry gates rather than the current release coordinator.
  ship.persona = 'orchestrator'
  ship.context = {
    ...ship.context,
    suite_profile: true,
    gate_evidence: true,
  }
  ship.criteria.push(
    ...checks.map((criterion) =>
      criterion.id === 'verify.final_fast'
        ? {
            ...criterion,
            id: 'ship.full_suite',
            command: 'pan repository-check full',
          }
        : criterion.id === 'verify.configuration'
          ? { ...criterion, id: 'ship.validate' }
          : criterion,
    ),
  )
  ship.criteria.push({
    id: 'ship.prior_gates_current',
    type: 'state',
    hard: true,
    statement: 'Legacy generic gate requires current verification evidence.',
  })
  ship.entry_gate = {
    criterion: 'ship.full_suite',
    failure: 'remediate',
    max_loops: 2,
  }
  writeJson(verifyPath, verify)
  writeJson(shipPath, ship)
  execFileSync(
    'git',
    [
      'add',
      'library/workflows/delivery/stages/verify.json',
      'library/workflows/delivery/stages/ship.json',
    ],
    { cwd: root, timeout: 180_000, maxBuffer: 1_024 * 1_024 },
  )
  execFileSync(
    'git',
    ['commit', '-qm', 'test: preserve legacy entry-gate workflow'],
    { cwd: root, timeout: 180_000, maxBuffer: 1_024 * 1_024 },
  )
}
