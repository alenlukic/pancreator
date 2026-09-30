import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateTurnReminderProfiles } from '../../src/lib/governance/prompt-context.js'
import {
  matchEditedInstruction,
  refreshGovernanceDigests,
  type RefreshDigestsReport,
} from '../../src/lib/governance/refresh-digests.js'
import { createFixture } from '../fixture-template.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')
const REGISTRY = 'governance/registries/turn_reminder_profiles.json'
const POLICY = 'governance/policies/DELEGATE-001.json'

interface PolicyFile {
  instructions: Array<string | { text: string }>
}

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

function readPolicy(root: string): PolicyFile {
  return JSON.parse(readFileSync(path.join(root, POLICY), 'utf8')) as PolicyFile
}

function writePolicy(root: string, policy: PolicyFile): void {
  writeFileSync(path.join(root, POLICY), `${JSON.stringify(policy, null, 2)}\n`)
}

function instructionText(entry: string | { text: string }): string {
  return typeof entry === 'string' ? entry : entry.text
}

/** Replace one instruction's text, keeping its audience shape. */
function withText(
  entry: string | { text: string },
  text: string,
): string | { text: string } {
  return typeof entry === 'string' ? text : { ...entry, text }
}

/** Index of the DELEGATE-001 instruction the `delegate-cadence` selector pins. */
function pinnedIndex(root: string): number {
  const policy = readPolicy(root)
  const index = policy.instructions.findIndex((entry) =>
    instructionText(entry).startsWith('The 60-second rule:'),
  )

  assert.ok(index >= 0, 'the fixture policy carries the pinned instruction')

  return index
}

function runRefresh(
  root: string,
  args: string[],
): { status: number | null; report: RefreshDigestsReport } {
  const child = spawnSync(
    process.execPath,
    [CLI, 'governance', 'refresh-digests', ...args, '--json'],
    { cwd: root, encoding: 'utf8' },
  )

  return {
    status: child.status,
    report: JSON.parse(child.stdout) as RefreshDigestsReport,
  }
}

/** Edit the pinned instruction and the self-development card section. */
function editPinnedSources(root: string): void {
  const policy = readPolicy(root)
  const index = pinnedIndex(root)
  const entry = policy.instructions[index] as string | { text: string }

  policy.instructions[index] = withText(
    entry,
    `${instructionText(entry)} The watch prints the cadence it enforces.`,
  )
  writePolicy(root, policy)

  const card = path.join(root, 'AGENTS.md')
  const original = readFileSync(card, 'utf8')
  const edited = original.replace(
    '## Invariants\n',
    '## Invariants\n\nEvery invariant below holds in every mode.\n',
  )

  assert.notEqual(edited, original, 'the fixture card holds ## Invariants')
  writeFileSync(card, edited)
}

test('refresh-digests repairs an edited instruction and card section so validation passes', () => {
  const root = createFixture()
  const registryPath = path.join(root, REGISTRY)
  const before = readFileSync(registryPath, 'utf8')

  assert.deepEqual(validateTurnReminderProfiles(root), [])
  editPinnedSources(root)

  const errors = validateTurnReminderProfiles(root)

  assert.ok(errors.length > 0)
  assert.ok(
    errors.every((error) => error.includes('`pan governance refresh-digests`')),
    errors.join('\n'),
  )

  // --check names the stale selectors, exits 1, and writes nothing.
  const checked = runRefresh(root, ['--check'])

  assert.equal(checked.status, 1)
  assert.equal(checked.report.status, 'stale')
  assert.equal(checked.report.written, false)
  assert.equal(readFileSync(registryPath, 'utf8'), before)
  assert.deepEqual(
    checked.report.selectors
      .map((result) => `${result.selector_id}:${result.mode ?? 'policy'}`)
      .sort(),
    ['card-invariants:self_development', 'delegate-cadence:policy'],
  )

  const policyResult = checked.report.selectors.find(
    (result) => result.selector_id === 'delegate-cadence',
  )

  assert.equal(policyResult?.match?.recovered_from, 'HEAD')
  assert.equal(policyResult?.match?.instruction_index, pinnedIndex(root))

  const refreshed = runRefresh(root, [])

  assert.equal(refreshed.status, 0)
  assert.equal(refreshed.report.status, 'refreshed')
  assert.equal(refreshed.report.written, true)
  assert.deepEqual(validateTurnReminderProfiles(root), [])

  // Only the stale digests change: the file keeps its key order and its
  // formatting, so the format check passes without a rewrite.
  let expected = before

  for (const result of refreshed.report.selectors) {
    assert.ok(result.current_sha256)
    expected = expected.replace(result.previous_sha256, result.current_sha256)
  }

  assert.equal(readFileSync(registryPath, 'utf8'), expected)

  const again = runRefresh(root, ['--check'])

  assert.equal(again.status, 0)
  assert.equal(again.report.status, 'current')
})

test('refresh-digests recovers a committed edit from the policy history', () => {
  const root = createFixture()

  editPinnedSources(root)
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'edit pinned sources'])

  const report = refreshGovernanceDigests(root)
  const policyResult = report.selectors.find(
    (result) => result.selector_id === 'delegate-cadence',
  )

  assert.equal(report.status, 'refreshed')
  assert.ok(policyResult?.match)
  assert.notEqual(policyResult.match.recovered_from, 'HEAD')
  assert.match(policyResult.match.recovered_from, /^[a-f0-9]{40}$/u)
  assert.deepEqual(validateTurnReminderProfiles(root), [])
})

test('refresh-digests refuses an ambiguous edit and writes nothing', () => {
  const root = createFixture()
  const registryPath = path.join(root, REGISTRY)
  const before = readFileSync(registryPath, 'utf8')
  const policy = readPolicy(root)
  const index = pinnedIndex(root)
  const entry = policy.instructions[index] as string | { text: string }
  const pinned = instructionText(entry)

  // The pinned instruction is split into two near-equal variants at the end,
  // and its old position now holds unrelated text, so no single instruction
  // is the edit's clear successor.
  policy.instructions[index] = withText(
    entry,
    'Unrelated placeholder about release notes.',
  )
  policy.instructions.push(
    withText(entry, `${pinned} First variant.`),
    withText(entry, `${pinned} Second variant.`),
  )
  writePolicy(root, policy)

  const { status, report } = runRefresh(root, [])
  const refused = report.selectors.find(
    (result) => result.selector_id === 'delegate-cadence',
  )

  assert.equal(status, 1)
  assert.equal(report.status, 'refused')
  assert.equal(report.written, false)
  assert.equal(readFileSync(registryPath, 'utf8'), before)
  assert.equal(refused?.status, 'refused')
  assert.match(refused?.reason ?? '', /ambiguous/u)
  assert.deepEqual(
    refused?.candidates?.map((candidate) => candidate.index).sort(),
    [policy.instructions.length - 2, policy.instructions.length - 1],
  )
})

test('the instruction at the old position breaks a near tie, and a removed one is refused', () => {
  const previous = { text: 'Agents MUST watch every worker.', index: 1 }

  const tie = matchEditedInstruction(previous, [
    'Agents MUST watch every worker now.',
    'Agents MUST watch every worker too.',
  ])

  assert.equal(tie.chosen?.index, 1)

  const removed = matchEditedInstruction(previous, [
    'Operators approve releases.',
  ])

  assert.equal(removed.chosen, null)
})

test('refresh-digests is refused outside self-development', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  assert.throws(
    () => refreshGovernanceDigests(root),
    /available only in self-development/u,
  )
})
