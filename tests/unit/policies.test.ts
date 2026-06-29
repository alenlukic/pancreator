import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createFixture } from '../helpers.js'
import { loadPolicyCatalog, resolvePolicies } from '../../src/lib/policies.js'

test('policy resolution unions global and stage-specific policies', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  assert.ok(catalog.size >= 8)
  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
  }).map((policy) => policy.id)
  assert.deepEqual(ids, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'CONTRACT-001',
    'DEV-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'TS-001',
    'VALID-001',
  ])
})

test('engineering handbook policy loads for reviewer and qa personas', () => {
  const root = createFixture()

  const reviewIds = resolvePolicies(root, {
    persona: 'reviewer',
    workflow: 'dev',
    stage: 'review',
  }).map((policy) => policy.id)

  assert.deepEqual(reviewIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'REVIEW-001',
    'TS-001',
    'VALID-001',
  ])

  const testIds = resolvePolicies(root, {
    persona: 'qa-tester',
    workflow: 'dev',
    stage: 'test',
  }).map((policy) => policy.id)

  assert.deepEqual(testIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'TEST-001',
    'TS-001',
    'VALID-001',
  ])
})

test('policy registry content remains canonical for inlining', () => {
  const root = createFixture()
  const catalog = loadPolicyCatalog(root)
  const action = catalog.get('ACTION-001')

  assert.ok(action)
  assert.equal(action.title, 'Safe source-control actions')
  assert.match(
    action.summary,
    /MUST NOT perform irreversible source-control actions/,
  )
  assert.equal(action.instructions.length, 2)
})

test('orchestration and release guidance resolve with required policy dependencies', () => {
  const root = createFixture()
  const orchestratorIds = resolvePolicies(root, {
    persona: 'orchestrator',
    workflow: 'dev',
    stage: 'intake',
  }).map((policy) => policy.id)
  const releaseIds = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'dev',
    stage: 'ship',
  }).map((policy) => policy.id)

  assert.deepEqual(orchestratorIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'INTAKE-001',
    'INVOCATION-001',
    'ORCH-001',
    'OUTPUT-001',
    'PAUSE-001',
    'PRIMER-001',
    'REPO-001',
    'VALID-001',
    'WAIVER-001',
    'WORK-001',
  ])
  assert.deepEqual(releaseIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PR-001',
    'PRIMER-001',
    'REPO-001',
    'SHIP-001',
    'VALID-001',
    'VERSION-001',
    'WAIVER-001',
    'WORK-001',
  ])
})

test('self-development version policy is excluded from embedded installations', () => {
  const root = createFixture()
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const releaseIds = resolvePolicies(root, {
    persona: 'release-steward',
    workflow: 'dev',
    stage: 'ship',
  }).map((policy) => policy.id)

  assert.ok(!releaseIds.includes('VERSION-001'))
  assert.ok(!releaseIds.includes('BIN-001'))
  assert.ok(!releaseIds.includes('TS-001'))
  assert.ok(releaseIds.includes('REPO-001'))
  assert.ok(releaseIds.includes('SHIP-001'))
})

test('embedded coding stages exclude Pancreator language and binary policies', () => {
  const root = createFixture()
  const configPath = path.join(root, 'project.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >

  config.installation_mode = 'embedded'
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  const ids = resolvePolicies(root, {
    persona: 'coder',
    workflow: 'dev',
    stage: 'implement',
  }).map((policy) => policy.id)

  assert.ok(!ids.includes('BIN-001'))
  assert.ok(!ids.includes('TS-001'))
  assert.ok(ids.includes('ENG-001'))
  assert.ok(ids.includes('REPO-001'))
})

test('decomposer loads conservative decomposition governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'decomposer',
    workflow: 'standalone',
    stage: 'decompose',
  }).map((policy) => policy.id)

  assert.deepEqual(ids, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'DECOMP-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'VALID-001',
  ])
})

test('standalone remediation personas load their work-mode policies', () => {
  const root = createFixture()

  const investigatorIds = resolvePolicies(root, {
    persona: 'investigator',
    workflow: 'standalone',
    stage: 'debug',
  }).map((policy) => policy.id)
  assert.deepEqual(investigatorIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'DIAG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'VALID-001',
    'WORK-001',
  ])

  const spotfixerIds = resolvePolicies(root, {
    persona: 'spotfixer',
    workflow: 'standalone',
    stage: 'spotfix',
  }).map((policy) => policy.id)
  assert.deepEqual(spotfixerIds, [
    'ACTION-001',
    'AUTO-001',
    'BIN-001',
    'CONTRACT-001',
    'ENG-001',
    'GLOBAL-001',
    'GLOBAL-002',
    'OUTPUT-001',
    'PRIMER-001',
    'REPO-001',
    'SPOT-001',
    'TS-001',
    'VALID-001',
    'WORK-001',
  ])
})

test('librarian loads target primer governance', () => {
  const root = createFixture()
  const ids = resolvePolicies(root, {
    persona: 'librarian',
    workflow: 'standalone',
    stage: 'build-docs',
  }).map((policy) => policy.id)

  assert.ok(ids.includes('PRIMER-001'))
  assert.ok(ids.includes('VALID-001'))
})
