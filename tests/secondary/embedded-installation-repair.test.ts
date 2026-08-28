import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  type InstallMarker,
  makeSkeletonProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('embedded installer clean reinstall removes stale harness payload', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
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

test('embedded installer supports deterministic repair, clean, and abort choices', () => {
  for (const choice of ['r', 'c', 'a']) {
    const project = makeSkeletonProject()

    try {
      mkdirSync(path.join(project, '.pancreator'), { recursive: true })
      writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

      const result = runInstaller(project, ['--choice', choice])

      assert.equal(result.status, 0, result.stderr)

      if (choice === 'a') {
        assert.match(result.stdout, /Aborted/)
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          false,
        )
      } else {
        assert.match(
          result.stdout,
          choice === 'r' ? /Repair completed/ : /Clean reinstall completed/,
        )
        assert.equal(
          existsSync(path.join(project, '.pancreator', 'install.json')),
          true,
        )
      }
    } finally {
      rmSync(project, { recursive: true, force: true })
    }
  }
})

test('embedded installer refresh supersedes local payload fixes and preserves extensions', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)

    const owned = path.join(
      project,
      '.pancreator',
      'docs',
      'runtime-protocol.md',
    )
    const pristine = readFileSync(owned, 'utf8')
    const extension = path.join(
      project,
      '.pancreator',
      'docs',
      'target-notes.md',
    )
    const policyExtension = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'policy_lookup.d',
      'target.json',
    )
    const legacyPolicyRows = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'rowspace_policy_rows.json',
    )
    const migratedPolicyExtension = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
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
    const lookupTable = path.join(
      project,
      '.pancreator',
      'governance',
      'registries',
      'policy_lookup_table.json',
    )
    const pristineLookup = readFileSync(lookupTable, 'utf8')

    writeFileSync(owned, 'locally patched\n')
    writeFileSync(extension, 'target extension\n')
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
    // The Pancreator source is authoritative for harness-owned files; the
    // local fix is flagged, backed up, and replaced.
    assert.match(refresh.stdout, /superseded {2}docs\/runtime-protocol\.md/u)
    assert.equal(readFileSync(owned, 'utf8'), pristine)
    // A file the release never shipped is a target extension and survives.
    assert.match(refresh.stdout, /preserved {2}docs\/target-notes\.md/u)
    assert.equal(readFileSync(extension, 'utf8'), 'target extension\n')
    assert.match(
      refresh.stdout,
      /preserved {2}governance\/registries\/policy_lookup\.d\/target\.json/u,
    )
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

    const backupRoot = path.join(project, '.pancreator', 'backups', 'payload')
    const stamps = readdirSync(backupRoot)

    assert.equal(stamps.length, 1)
    assert.equal(
      readFileSync(
        path.join(backupRoot, stamps[0], 'docs', 'runtime-protocol.md'),
        'utf8',
      ),
      'locally patched\n',
    )

    // A second refresh has nothing to flag: the extension is preserved again
    // without ever being recorded as release-owned content.
    const second = runInstaller(project, ['--yes'])

    assert.equal(second.status, 0, second.stderr)
    assert.doesNotMatch(second.stdout, /superseded {2}/u)
    assert.equal(readFileSync(extension, 'utf8'), 'target extension\n')
    assert.match(readFileSync(policyExtension, 'utf8'), /TARGET-001/u)
    assert.equal(readFileSync(lookupTable, 'utf8'), pristineLookup)
    assert.equal(existsSync(legacyPolicyRows), true)
    assert.match(readFileSync(migratedPolicyExtension, 'utf8'), /ROWSPACE-001/u)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
