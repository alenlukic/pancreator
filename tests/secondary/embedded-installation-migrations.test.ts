import assert from 'node:assert/strict'
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  cloneInstalledProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('embedded installer migrates a legacy project.json to config.json', () => {
  const project = cloneInstalledProject()
  const customCoderModel = 'operator-legacy-coder-model[fast=false]'
  const pancreatorDir = path.join(project, '.pancreator')
  const configPath = path.join(pancreatorDir, 'config.json')
  const legacyPath = path.join(pancreatorDir, 'project.json')

  try {
    // Reproduce a pre-rename installation carrying an operator edit.
    const config = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configPath)

    config.active_config = 'simple'
    config.configs.simple.personas.coder = customCoderModel
    writeFileSync(legacyPath, `${JSON.stringify(config, null, 2)}\n`)
    rmSync(configPath)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Migrated harness configuration/)

    assert.equal(existsSync(configPath), true)
    assert.equal(existsSync(legacyPath), false)

    const migrated = readJson<{
      active_config: string
      installation_mode: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configPath)

    assert.equal(migrated.active_config, 'simple')
    assert.equal(migrated.installation_mode, 'embedded')
    assert.equal(migrated.configs.simple.personas.coder, customCoderModel)

    // The projected agent must pick the migrated mapping up, proving the
    // migration ran before persona projection rather than after.
    const coderAgent = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
      'utf8',
    )

    assert.ok(coderAgent.includes(`model: ${customCoderModel}`))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh clears superseded legacy state in one pass', () => {
  // One refresh covers four migrations at once, because each seeds a disjoint
  // artifact: a superseded project.json beside the live config.json, a
  // runtime-located primer, a fast profile that duplicates full, and a
  // config.json whose active configuration needs compaction.
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const configJsonPath = path.join(pancreatorDir, 'config.json')
  const legacyProjectJsonPath = path.join(pancreatorDir, 'project.json')
  const currentPrimer = path.join(
    pancreatorDir,
    'docs',
    'target-repo-primer.md',
  )
  const legacyPrimer = path.join(
    pancreatorDir,
    'runtime',
    'target-repo-primer.md',
  )
  const checksPath = path.join(
    pancreatorDir,
    'runtime',
    'repository-checks.json',
  )

  try {
    // A legacy project.json alongside the live config.json is superseded.
    writeFileSync(
      legacyProjectJsonPath,
      '{"schema_version":1,"active_config":"stale"}\n',
    )

    // A primer still living under runtime predates the docs move.
    rmSync(currentPrimer)
    writeFileSync(legacyPrimer, 'legacy generated primer\n')

    // A generated fast profile that duplicates full must be disabled.
    writeFileSync(
      checksPath,
      `${JSON.stringify(
        {
          schema_version: 1,
          profiles: {
            fast: {
              description: 'incorrect generated fast profile',
              probes: ['node --version'],
              commands: ['node -e "process.exit(0)"'],
            },
            full: {
              description: 'complete suite',
              probes: ['node --version'],
              commands: ['node   -e   "process.exit(0)"'],
            },
          },
        },
        null,
        2,
      )}\n`,
    )

    // The active configuration restates one inherited default (to compact),
    // omits one of its own entries (to restore), and carries an operator
    // model (to preserve).
    const config = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)
    const activeConfigName = 'extreme'
    const activePersonas = config.configs[activeConfigName].personas
    const inheritedEntry = Object.entries(config.defaults).find(
      ([persona]) => activePersonas[persona] === undefined,
    )
    const omittedEntry = Object.entries(activePersonas).find(
      ([persona]) => persona !== 'reviewer',
    )

    assert.ok(inheritedEntry)
    assert.ok(omittedEntry)

    const customReviewerModel = 'operator-custom-reviewer[fast=false]'
    const [inheritedPersona, inheritedModel] = inheritedEntry
    const [omittedPersona, omittedModel] = omittedEntry

    config.active_config = activeConfigName
    activePersonas.reviewer = customReviewerModel
    activePersonas[inheritedPersona] = inheritedModel
    delete activePersonas[omittedPersona]
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)

    // The superseded project.json is retained only as a backup.
    assert.equal(existsSync(legacyProjectJsonPath), false)

    const configBackupRoot = path.join(pancreatorDir, 'backups', 'config')
    const stamps = readdirSync(configBackupRoot)

    assert.equal(stamps.length, 1)
    assert.equal(
      existsSync(path.join(configBackupRoot, stamps[0]!, 'project.json')),
      true,
    )

    // The runtime primer moved into docs with its content intact.
    assert.equal(
      readFileSync(currentPrimer, 'utf8'),
      'legacy generated primer\n',
    )
    assert.equal(existsSync(legacyPrimer), false)

    // The duplicated fast profile was disabled and the original backed up.
    const migrated = readJson<{
      profiles: Record<string, { commands: string[]; probes: string[] }>
      $operator?: { migration_notes?: string[] }
    }>(checksPath)

    assert.deepEqual(migrated.profiles.fast?.commands, [])
    assert.deepEqual(migrated.profiles.fast?.probes, [])
    assert.deepEqual(migrated.profiles.full?.commands, [
      'node   -e   "process.exit(0)"',
    ])
    assert.deepEqual(migrated.profiles.secondary?.commands, [])
    assert.match(
      migrated.$operator?.migration_notes?.join('\n') ?? '',
      /distinct default\/primary suite/u,
    )

    const checksBackupRoot = path.join(
      pancreatorDir,
      'backups',
      'repository-checks',
    )

    assert.equal(readdirSync(checksBackupRoot).length, 1)
    assert.match(
      readFileSync(
        path.join(checksBackupRoot, readdirSync(checksBackupRoot)[0]),
        'utf8',
      ),
      /incorrect generated fast profile/u,
    )

    // Compaction: the restated default is dropped, the omitted entry is
    // restored, the operator model survives and reaches the projected agent.
    const refreshed = readJson<{
      active_config: string
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)
    const active = refreshed.configs[activeConfigName]

    assert.equal(refreshed.active_config, activeConfigName)
    assert.equal(active.personas.reviewer, customReviewerModel)
    assert.equal(active.personas[inheritedPersona], undefined)
    assert.equal(active.personas[omittedPersona], omittedModel)
    assert.ok(
      readFileSync(
        path.join(project, '.cursor', 'agents', `pan-${inheritedPersona}.md`),
        'utf8',
      ).includes(`model: ${inheritedModel}`),
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
