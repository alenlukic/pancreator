import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  buildReviewClosure,
  resolveReviewScope,
} from '../../src/lib/review-scope.js'
import { createFixture } from '../helpers.js'

function git(root: string, args: string[]): string {
  return execFileSync(
    'git',
    ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args],
    { cwd: root, encoding: 'utf8' },
  ).trim()
}

function commitAll(root: string, message: string): string {
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', message])

  return git(root, ['rev-parse', 'HEAD'])
}

/**
 * `resolveReviewScope` is the one entry point the review command calls. These
 * cases run it against a real fixture repository, because the closure paths
 * and the git wiring are exactly what a hand-built closure cannot pin.
 */
test('the closure names real persona surfaces', () => {
  const root = createFixture()
  const closure = buildReviewClosure(root)

  assert.equal(closure.persona_paths.length, 4)

  for (const relative of closure.persona_paths) {
    assert.ok(existsSync(path.join(root, relative)), relative)
  }

  assert.ok(closure.policies['REVIEW-001'])
})

test('an identical base and head is clean and independent', () => {
  const root = createFixture()
  const head = git(root, ['rev-parse', 'HEAD'])
  const scope = resolveReviewScope(root, { head, base: head })

  assert.deepEqual(scope.changed_paths, [])
  assert.equal(scope.clean, true)
  assert.equal(scope.independent, true)
  assert.deepEqual(scope.standards_delta, [])
})

test('a target with no merge base is rejected by code', () => {
  const root = createFixture()
  const head = git(root, ['rev-parse', 'HEAD'])

  assert.throws(
    () => resolveReviewScope(root, { head, defaultBranch: 'no-such-branch' }),
    (error: unknown) =>
      error instanceof PanError && error.code === 'REVIEW_BASE_UNRESOLVED',
  )
})

test('a reviewer mapping change in config.json is an instrument conflict', () => {
  const root = createFixture()
  const base = git(root, ['rev-parse', 'HEAD'])
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
  }

  config.defaults.reviewer = 'fixture-model'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const head = commitAll(root, 'route the reviewer elsewhere')
  const scope = resolveReviewScope(root, { head, base })

  assert.deepEqual(
    scope.conflicts.filter((item) => item.path === 'config.json'),
    [
      {
        path: 'config.json',
        tier: 'instrument',
        source: 'reviewer or coordinator model mapping changed',
      },
    ],
  )
  assert.equal(scope.independent, false)
})

test('a policy change yields one standards delta and a rename keeps both sides', () => {
  const root = createFixture()
  const base = git(root, ['rev-parse', 'HEAD'])
  const policyPath = path.join(root, 'governance/policies/GLOBAL-002.json')
  const policy = JSON.parse(readFileSync(policyPath, 'utf8')) as {
    instructions: string[]
  }

  policy.instructions.push('Agents MUST honor a fixture-only clause.')
  writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`)
  // Renaming a lineup file is the ordinary way a charter gets restructured.
  // Both sides must stay in the change set, or the instrument conflict on the
  // old path disappears. The harness lineup is renamed rather than the core
  // skill, because the closure reads the core skill from the working tree.
  git(root, [
    'mv',
    'library/skills/review-squad-pancreator.md',
    'library/skills/review-lineup-pancreator.md',
  ])

  const head = commitAll(root, 'change a rule and rename the lineup')
  const scope = resolveReviewScope(root, { head, base })

  assert.deepEqual(
    scope.standards_delta.map((delta) => [delta.policy, delta.status]),
    [['GLOBAL-002', 'changed']],
  )
  assert.deepEqual(scope.standards_delta[0]?.added_instructions, [
    'Agents MUST honor a fixture-only clause.',
  ])
  assert.equal(scope.standards_delta[0]?.malformed, null)
  assert.ok(
    scope.changed_paths.includes('library/skills/review-squad-pancreator.md'),
  )
  assert.ok(
    scope.conflicts.some(
      (item) =>
        item.path === 'library/skills/review-squad-pancreator.md' &&
        item.tier === 'instrument',
    ),
  )
})

test('a malformed policy is reported as malformed, not as a wholesale removal', () => {
  const root = createFixture()
  const policyPath = path.join(root, 'governance/policies/GLOBAL-002.json')
  const valid = readFileSync(policyPath, 'utf8')

  // The malformed side is the base: the working tree, which the closure
  // reads, holds the head. A change that repairs a broken policy file must
  // read as a repair, not as the addition of every instruction it carries.
  writeFileSync(policyPath, '{ "id": "GLOBAL-002", "instructions": [ not json')

  const base = commitAll(root, 'break a policy file')

  writeFileSync(policyPath, valid)

  const head = commitAll(root, 'repair the policy file')
  const delta = resolveReviewScope(root, { head, base }).standards_delta[0]

  assert.ok(delta)
  assert.equal(delta.malformed, 'base')
  assert.deepEqual(delta.removed_instructions, [])
  assert.deepEqual(delta.added_instructions, [])
})
