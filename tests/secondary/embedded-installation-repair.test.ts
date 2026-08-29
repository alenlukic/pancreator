import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  type InstallMarker,
  cloneInstalledProject,
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('embedded installer clean reinstall removes stale harness payload', () => {
  const project = cloneInstalledProject()

  try {
    writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

    const retiredPath = path.join(project, '.cursor', 'commands', 'retired.md')
    const retiredContent = 'retired Pancreator command\n'

    writeFileSync(retiredPath, retiredContent)

    const markerPath = path.join(project, '.pancreator', 'install.json')
    const marker = readJson<InstallMarker>(markerPath)

    marker.cursor_files.push({
      path: '.cursor/commands/retired.md',
      sha256: createHash('sha256').update(retiredContent).digest('hex'),
    })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    const result = runInstaller(project, ['--clean'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Clean reinstall completed/)
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'stale.txt')),
      false,
    )
    assert.equal(existsSync(retiredPath), false)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer requires an explicit partial-install decision', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })

    const result = runInstaller(project)

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /partial installation detected/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer supports deterministic clean and abort choices', () => {
  for (const choice of ['c', 'a']) {
    const project = makeSkeletonProject()

    try {
      mkdirSync(path.join(project, '.pancreator'), { recursive: true })
      writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

      const result = runInstaller(project, ['--choice', choice])

      assert.equal(result.status, 0, result.stderr)

      if (choice === 'a') {
        // The abort happens before any payload copy.
        assert.match(result.stdout, /Aborted/)
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          false,
        )
      } else {
        assert.match(result.stdout, /Clean reinstall completed/)
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          true,
        )
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'stale.txt')),
          false,
        )
      }
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  }
})

test('embedded installer refresh preserves policy extensions and migrates legacy policy rows', () => {
  const project = cloneInstalledProject()

  try {
    const registries = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
    )
    const policyExtension = path.join(
      registries,
      'policy_lookup.d',
      'target.json',
    )
    const legacyPolicyRows = path.join(registries, 'rowspace_policy_rows.json')
    const migratedPolicyExtension = path.join(
      registries,
      'policy_lookup.d',
      'rowspace.json',
    )
    const targetPolicy = path.join(
      project,
      '.pancreator',
      'governance',
      'policies',
      'ROWSPACE-001.json',
    )
    const lookupTable = path.join(registries, 'policy_lookup_table.json')
    const pristineLookup = readFileSync(lookupTable, 'utf8')

    mkdirSync(path.dirname(policyExtension), { recursive: true })
    writeFileSync(
      policyExtension,
      '{"schema_version":1,"rows":[{"persona":"tech-lead","workflow":"dev","stage":"plan","policies":["TARGET-001"]}]}\n',
    )
    writeFileSync(
      targetPolicy,
      '{"id":"ROWSPACE-001","extension_id":"rowspace","title":"Rowspace","severity":"hard","summary":"Agents MUST obey Rowspace.","instructions":["Agents MUST obey Rowspace."]}\n',
    )
    writeFileSync(
      legacyPolicyRows,
      '{"rows":[{"persona":"release-steward","workflow":"dev","stage":"ship","policies":["ROWSPACE-001"]}]}\n',
    )

    const refresh = runInstaller(project, ['--yes'])

    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(readFileSync(policyExtension, 'utf8'), /TARGET-001/u)
    assert.equal(readFileSync(lookupTable, 'utf8'), pristineLookup)
    assert.equal(existsSync(legacyPolicyRows), true)
    assert.deepEqual(
      JSON.parse(readFileSync(migratedPolicyExtension, 'utf8')),
      {
        schema_version: 1,
        extension_id: 'rowspace',
        policies: ['ROWSPACE-001'],
        rows: [
          {
            persona: 'release-steward',
            workflow: 'dev',
            stage: 'ship',
            policies: ['ROWSPACE-001'],
          },
        ],
      },
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
