import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { validateImplementationClaims } from '../../src/lib/validators/stage-validators.js'
import { createFixture, writeJson } from '../helpers.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { claimsValidatorInput } from './validators-stage-validators-helpers.js'

function writeImplementOutput(
  root: string,
  target: string,
  testsAdded: unknown[],
): void {
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(
    absolute,
    `${JSON.stringify({
      data: {
        implementation: {
          changed_files: [],
          tests_added: testsAdded,
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture evidence'] },
        ],
      },
    })}\n`,
  )
}

function contractIssues(issues: Array<{ code: string; message: string }>) {
  return issues.filter(
    (issue) => issue.code === 'implementation.tests_added_contract_missing',
  )
}

test('implementation claims accept declared blocked data but reject empty success acceptance', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-blocked/outputs/implement-1-test.json'

  writeJson(path.join(root, target), {
    result: 'blocked',
    data: {
      blocked: {
        missing_precondition: 'The required fixture service is unavailable.',
        supplying_command: 'fixture-service start',
        evidence: ['fixture-service status exited 3: not running'],
      },
      acceptance_results: [],
    },
  })

  const blocked = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(blocked.status, 'passed', JSON.stringify(blocked.issues))

  // The plan asks a blocked output to carry evidence for the gap it names, so
  // a reason with nothing behind it is not an honest refusal.
  writeJson(path.join(root, target), {
    result: 'blocked',
    data: {
      blocked: {
        missing_precondition: 'The required fixture service is unavailable.',
        supplying_command: 'fixture-service start',
        evidence: [],
      },
      acceptance_results: [],
    },
  })

  const unevidenced = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(unevidenced.status, 'failed')
  assert.ok(
    unevidenced.issues.some((issue) => issue.code === 'blocked.evidence'),
    JSON.stringify(unevidenced.issues),
  )

  writeJson(path.join(root, target), {
    result: 'blocked',
    data: {
      blocked: {
        missing_precondition: 'The required fixture service is unavailable.',
        supplying_command: 'fixture-service start',
        evidence: ['fixture-service status exited 3: not running'],
      },
      acceptance_results: {},
    },
  })

  const nonArrayAcceptance = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.ok(
    nonArrayAcceptance.issues.some(
      (issue) => issue.code === 'blocked.acceptance_results',
    ),
  )

  writeJson(path.join(root, target), {
    result: 'blocked',
    data: {
      blocked: {
        missing_precondition: 'The required fixture service is unavailable.',
        supplying_command: 'fixture-service start',
        evidence: ['fixture-service status exited 3: not running'],
      },
      implementation: {
        changed_files: [],
        tests_added: [],
        notes: [],
      },
      acceptance_results: [
        { id: 'AC-01', result: 'pass', evidence: ['unsupported claim'] },
      ],
    },
  })

  const claimed = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(claimed.status, 'failed')
  assert.ok(
    claimed.issues.some((issue) => issue.code === 'blocked.acceptance_results'),
  )
  assert.ok(
    claimed.issues.some(
      (issue) => issue.code === 'blocked.implementation_forbidden',
    ),
  )

  writeJson(path.join(root, target), {
    result: 'success',
    data: {
      implementation: {
        changed_files: [],
        tests_added: [],
        notes: [],
      },
      acceptance_results: [],
    },
  })

  const success = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(success.status, 'failed')
  assert.ok(success.issues.some((issue) => issue.code === 'acceptance.missing'))
})

test('a blocked implement output discloses its workspace edits through workspace_changes', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-blocked-edits/outputs/implement-1-test.json'
  const before = gitWorkspaceSnapshot(root)
  const blocked = {
    missing_precondition:
      'The child specification names criteria without text.',
    supplying_command: 'pan plan show --run run-blocked-edits',
    evidence: ['runtime/logs/workflows/run-blocked-edits/operator/request.md'],
  }

  // The worker edited a tracked file before it found the gap and stopped.
  // `data.implementation` is forbidden on a blocked result, so the edit has
  // no claim list to appear in; the Git delta still holds it.
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')

  writeJson(path.join(root, target), {
    result: 'blocked',
    data: { blocked, acceptance_results: [] },
  })

  const undisclosed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(undisclosed.status, 'failed')
  assert.ok(
    undisclosed.issues.some(
      (issue) =>
        issue.code === 'blocked.diff_not_disclosed' &&
        issue.message.includes('src/base.ts'),
    ),
    JSON.stringify(undisclosed.issues),
  )

  writeJson(path.join(root, target), {
    result: 'blocked',
    workspace_changes: {
      attribution: 'internal',
      paths: ['src/base.ts'],
      explanation:
        'Started the base edit before the specification gap surfaced.',
    },
    data: { blocked, acceptance_results: [] },
  })

  const disclosed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(disclosed.status, 'passed', JSON.stringify(disclosed.issues))

  // Without an invocation snapshot the cumulative working-tree diff is the
  // observable delta, and it owes the same disclosure.
  writeJson(path.join(root, target), {
    result: 'blocked',
    data: { blocked, acceptance_results: [] },
  })

  const cumulative = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.ok(
    cumulative.issues.some(
      (issue) => issue.code === 'blocked.diff_not_disclosed',
    ),
    JSON.stringify(cumulative.issues),
  )
})

test('implementation claims disclose every attributed workspace path', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-attribution/outputs/implement-1-test.json'

  writeJson(path.join(root, target), {
    workspace_changes: {
      attribution: 'internal',
      paths: ['src/lib/engine.ts'],
      explanation: 'The stage edited the engine.',
    },
    data: {
      implementation: {
        changed_files: [],
        tests_added: [],
        notes: [],
      },
      acceptance_results: [
        { id: 'AC-01', result: 'pass', evidence: ['fixture evidence'] },
      ],
    },
  })

  const result = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.ok(
    result.issues.some(
      (issue) => issue.code === 'claim.attribution_not_disclosed',
    ),
    JSON.stringify(result.issues),
  )
})

test('tests_added requires a contract for a new test file and accepts one that names it', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-contract/outputs/implement-1-test.json'
  const before = gitWorkspaceSnapshot(root)

  mkdirSync(path.join(root, 'tests/unit'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests/unit/fresh.test.ts'),
    "test('one', () => {})\nit('two', () => {})\n",
  )

  // A bare string still parses as { path } and fails only because the delta
  // requires a contract.
  writeImplementOutput(root, target, ['tests/unit/fresh.test.ts'])

  const bare = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )
  const missing = contractIssues(bare.issues)

  assert.equal(bare.status, 'failed')
  assert.equal(missing.length, 1)
  assert.match(
    missing[0].message,
    /tests\/unit\/fresh\.test\.ts is a new test file with 2 test call site\(s\)/u,
  )
  assert.ok(!bare.issues.some((issue) => issue.code === 'claim.entry_shape'))

  writeImplementOutput(root, target, [
    {
      path: 'tests/unit/fresh.test.ts',
      contract: 'A fresh file proves the fixture accepts a contract.',
    },
  ])

  const named = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(named.status, 'passed', JSON.stringify(named.issues))

  // An entry object without a path is a shape defect, not a missing contract.
  writeImplementOutput(root, target, [{ contract: 'no path' }])

  const malformed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.ok(
    malformed.issues.some((issue) => issue.code === 'claim.entry_shape'),
  )
})

test('tests_added requires a contract for a net-positive delta and ignores unchanged tests', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-delta/outputs/implement-1-test.json'

  mkdirSync(path.join(root, 'tests/unit'), { recursive: true })
  writeFileSync(
    path.join(root, 'tests/unit/grown.test.ts'),
    "test('one', () => {})\n",
  )
  writeFileSync(
    path.join(root, 'tests/unit/steady.test.ts'),
    "test('steady', () => {})\n",
  )
  execFileSync('git', ['add', '.'], { cwd: root })
  execFileSync(
    'git',
    ['-c', 'user.email=f@e.com', '-c', 'user.name=F', 'commit', '-qm', 'tests'],
    {
      cwd: root,
    },
  )

  const before = gitWorkspaceSnapshot(root)

  // A source change with no test change needs nothing.
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  writeImplementOutput(root, target, [])

  const untouched = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(untouched.status, 'passed', JSON.stringify(untouched.issues))

  // Rewording an existing test keeps the count flat: still nothing required.
  writeFileSync(
    path.join(root, 'tests/unit/steady.test.ts'),
    "test('steady renamed', () => {})\n",
  )

  const reworded = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(contractIssues(reworded.issues).length, 0)

  // Two new call sites in a tracked file need one covering entry.
  writeFileSync(
    path.join(root, 'tests/unit/grown.test.ts'),
    "test('one', () => {})\ntest('two', () => {})\ntest.skip('three', () => {})\n",
  )

  const grown = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )
  const missing = contractIssues(grown.issues)

  assert.equal(missing.length, 1)
  assert.match(
    missing[0].message,
    /tests\/unit\/grown\.test\.ts gained 2 net test call site\(s\)/u,
  )

  // An empty contract does not cover the delta; a sentence does.
  writeImplementOutput(root, target, [
    { path: 'tests/unit/grown.test.ts', contract: '  ' },
  ])
  assert.equal(
    contractIssues(
      validateImplementationClaims(
        claimsValidatorInput(root, target, { workspace_before: before }),
      ).issues,
    ).length,
    1,
  )

  writeImplementOutput(root, target, [
    {
      path: 'tests/unit/grown.test.ts::two',
      contract: 'The grown file proves a second contract.',
    },
  ])

  const covered = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(covered.status, 'passed', JSON.stringify(covered.issues))

  // Without an invocation snapshot the cumulative working-tree diff is the
  // observable delta and reports the same file.
  writeImplementOutput(root, target, [])

  const cumulative = validateImplementationClaims(
    claimsValidatorInput(root, target),
  )

  assert.equal(contractIssues(cumulative.issues).length, 1)
})

test('a file the attempt deleted is disclosed in changed_files, not rejected', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-deletion/outputs/implement-1-test.json'
  const before = gitWorkspaceSnapshot(root)
  const writeClaims = (changedFiles: string[]): void => {
    writeJson(path.join(root, target), {
      data: {
        implementation: {
          changed_files: changedFiles,
          tests_added: [],
          notes: [],
        },
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture evidence'] },
        ],
      },
    })
  }

  // The cumulative diff lists existing files only, so a deletion appears in
  // the attempt delta alone. Before this rule a deletion was unsubmittable:
  // listing it failed as not in the diff and omitting it failed as
  // undisclosed.
  writeFileSync(path.join(root, 'src/base.ts'), 'export const base = false\n')
  rmSync(path.join(root, 'README.md'))

  writeClaims(['src/base.ts', 'README.md'])

  const disclosed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(disclosed.status, 'passed', JSON.stringify(disclosed.issues))

  writeClaims(['src/base.ts'])

  const undisclosed = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.ok(
    undisclosed.issues.some(
      (issue) =>
        issue.code === 'claim.diff_not_disclosed' &&
        issue.message.includes('README.md'),
    ),
    JSON.stringify(undisclosed.issues),
  )

  // A path that neither exists nor changed is still a fabricated claim.
  writeClaims(['src/base.ts', 'README.md', 'src/never-existed.ts'])

  const fabricated = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.ok(
    fabricated.issues.some(
      (issue) =>
        issue.code === 'claim.not_in_diff' &&
        issue.message.includes('src/never-existed.ts'),
    ),
    JSON.stringify(fabricated.issues),
  )
})

// The output is a claim about a tree. An attempt that kept editing after it
// wrote the output described a tree that no longer existed, and every
// disclosure check passed because the edit was still in the diff.
test('a claimed path modified after the output fails, and an ordered one passes', () => {
  const root = createFixture()
  const target =
    'runtime/logs/workflows/run-ordering/outputs/implement-1-test.json'
  const before = gitWorkspaceSnapshot(root)
  const source = path.join(root, 'src/ordered.ts')

  writeFileSync(source, 'export const ordered = true\n')
  writeJson(path.join(root, target), {
    data: {
      implementation: {
        changed_files: ['src/ordered.ts'],
        tests_added: [],
        notes: [],
      },
      acceptance_results: [
        { id: 'AC-01', result: 'pass', evidence: ['fixture evidence'] },
      ],
    },
  })

  const ordered = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.equal(ordered.status, 'passed', JSON.stringify(ordered.issues))

  // The edit that follows the output is the one the output cannot describe.
  const outputModified = statSync(path.join(root, target)).mtime

  utimesSync(source, outputModified, new Date(outputModified.getTime() + 5_000))

  const late = validateImplementationClaims(
    claimsValidatorInput(root, target, { workspace_before: before }),
  )

  assert.ok(
    late.issues.some(
      (issue) =>
        issue.code === 'claim.modified_after_output' &&
        issue.message.includes('src/ordered.ts'),
    ),
    JSON.stringify(late.issues),
  )
})
