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
  cloneInstalledProject,
  readJson,
  runInstaller,
} from './install-helpers.js'

test('embedded installer refresh reconciles persona mappings and agent ownership while preserving target state', () => {
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const customCoderModel = 'operator-custom-coder-model[fast=false]'
  const retiredPersona = 'tech-lead'
  const retiredModel = 'retired-persona-model[fast=false]'
  const legacyAgent = path.join(project, '.cursor', 'agents', 'coder.md')
  const markerPath = path.join(pancreatorDir, 'install.json')
  const configJsonPath = path.join(pancreatorDir, 'config.json')

  try {
    const config = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    config.active_config = 'simple'
    config.configs.simple.personas.coder = customCoderModel
    config.defaults[retiredPersona] = retiredModel
    config.configs.simple.personas[retiredPersona] = retiredModel
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    // Reproduce an install made before agents were namespaced, where the
    // marker records Pancreator as the owner of the old path.
    const contents = 'pancreator-owned coder\n'

    writeFileSync(legacyAgent, contents)

    const marker = readJson<InstallMarker>(markerPath)

    marker.cursor_files.push({
      path: '.cursor/agents/coder.md',
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    writeFileSync(
      path.join(pancreatorDir, 'runtime', 'inbox', 'request.md'),
      'keep me\n',
    )
    writeFileSync(path.join(project, '.cursor', 'custom.md'), 'keep me\n')
    writeFileSync(
      path.join(pancreatorDir, 'docs', 'target-repo-primer.md'),
      'generated primer\n',
    )
    writeFileSync(
      path.join(pancreatorDir, 'runtime', 'repository-checks.json'),
      '{\n  "schema_version": 1,\n  "profiles": {\n    "full": {\n      "probes": ["python --version"],\n      "commands": ["python -m pytest"]\n    }\n  }\n}\n',
    )

    const dispositionLayerPath = path.join(
      pancreatorDir,
      'governance',
      'registries',
      'context_bloat_dispositions.d',
      'target-layer.json',
    )

    mkdirSync(path.dirname(dispositionLayerPath), { recursive: true })
    writeFileSync(
      dispositionLayerPath,
      `${JSON.stringify({
        schema_version: 1,
        extension_id: 'target-layer',
        entries: [
          {
            id: 'target-handbook-boilerplate',
            category: 'duplicate',
            sources: ['governance/handbooks/target-owned/'],
            disposition: 'retain',
            rationale: 'Target-owned guidance restates the RFC 2119 preamble.',
            evidence: ['governance/handbooks/target-owned/'],
          },
        ],
      })}\n`,
    )

    const briefSystemDirectory = path.join(
      pancreatorDir,
      'docs',
      'operator-briefs',
    )

    mkdirSync(briefSystemDirectory, { recursive: true })
    writeFileSync(
      path.join(briefSystemDirectory, 'project.json'),
      '{"target":"custom-registry"}\n',
    )
    writeFileSync(
      path.join(briefSystemDirectory, 'project.css'),
      ':root { --target-token: 1; }\n',
    )

    const legacyWorktreeNote = path.join(
      pancreatorDir,
      'runtime',
      'worktrees',
      'operator',
      'legacy-note.txt',
    )

    mkdirSync(path.dirname(legacyWorktreeNote), { recursive: true })
    writeFileSync(legacyWorktreeNote, 'legacy bytes\n')

    mkdirSync(path.join(pancreatorDir, 'runtime', 'locks'), {
      recursive: true,
    })
    writeFileSync(
      path.join(pancreatorDir, 'runtime', 'locks', 'stale.json'),
      '{}\n',
    )

    const legacyRunDirectory = path.join(
      pancreatorDir,
      'runtime',
      'logs',
      'workflows',
      'legacy-run',
    )

    mkdirSync(legacyRunDirectory, { recursive: true })
    writeFileSync(path.join(legacyRunDirectory, '.lock'), '99999999\n')

    const retiredValidationName = `led${'ger'}-validation.json`

    writeFileSync(path.join(legacyRunDirectory, retiredValidationName), '{}\n')
    writeFileSync(path.join(legacyRunDirectory, 'baseline.json'), '{}\n')

    const retiredStateDirectory = path.join(
      pancreatorDir,
      'runtime',
      'workflows',
      'legacy-run',
    )

    mkdirSync(retiredStateDirectory, { recursive: true })
    writeFileSync(
      path.join(retiredStateDirectory, retiredValidationName),
      '{}\n',
    )
    writeFileSync(path.join(retiredStateDirectory, 'baseline.json'), '{}\n')

    const legacyWorkspaceDirectory = path.join(
      pancreatorDir,
      'runtime',
      'workspace',
    )

    mkdirSync(legacyWorkspaceDirectory, { recursive: true })
    writeFileSync(
      path.join(legacyWorkspaceDirectory, 'active-workflow.json'),
      '{}\n',
    )

    const oldRunId = '63379_Jun-22_5f354f23'
    // The prefix migration adds the minute component. The suffix migration
    // then replaces the hex fragment with keywords from the run title.
    const migratedOldRunId = '63379_Jun-22-0158_old-run'
    const oldRunDirectory = path.join(
      pancreatorDir,
      'runtime',
      'logs',
      'workflows',
      oldRunId,
    )
    const oldStateDirectory = path.join(
      pancreatorDir,
      'runtime',
      'workflows',
      oldRunId,
    )

    mkdirSync(oldRunDirectory, { recursive: true })
    mkdirSync(oldStateDirectory, { recursive: true })
    writeFileSync(
      path.join(oldRunDirectory, 'state.json'),
      `${JSON.stringify({
        schema_version: 1,
        run_id: oldRunId,
        workflow_slug: 'dev',
        title: 'old run',
        status: 'succeeded',
        pending_action: { type: 'none' },
        stage_history: [],
        attempts: {},
        created_at: '2026-06-22T21:22:54.051Z',
      })}\n`,
    )
    writeFileSync(
      path.join(oldRunDirectory, 'workflow.snapshot.json'),
      '{"stages":[{"slug":"intake"}]}\n',
    )
    writeFileSync(path.join(oldRunDirectory, 'events.jsonl'), '')
    writeFileSync(
      path.join(oldStateDirectory, 'modifications.jsonl'),
      `${JSON.stringify({ run_id: oldRunId })}\n`,
    )

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation refresh completed/)

    const refreshed = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    assert.equal(refreshed.active_config, 'simple')
    assert.equal(refreshed.configs.simple.personas.coder, customCoderModel)
    assert.ok(
      readFileSync(
        path.join(project, '.cursor', 'agents', 'pan-coder.md'),
        'utf8',
      ).includes(`model: ${customCoderModel}`),
    )

    assert.equal(refreshed.defaults[retiredPersona], undefined)
    assert.equal(
      refreshed.configs.simple.personas[retiredPersona],
      undefined,
      'a retired persona MUST NOT survive a refresh',
    )

    assert.equal(existsSync(legacyAgent), false)
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )

    // Runtime maintenance migrates a loose inbox file to queue, renames it
    // onto the temporal prefix scheme, and keeps the content.
    const queueDirectory = path.join(pancreatorDir, 'runtime', 'inbox', 'queue')
    const standardizedRequest = readdirSync(queueDirectory).find((name) =>
      /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_request\.md$/u.test(name),
    )

    assert.ok(standardizedRequest, 'inbox request was not standardized')
    assert.equal(
      readFileSync(path.join(queueDirectory, standardizedRequest), 'utf8'),
      'keep me\n',
    )
    assert.equal(
      readFileSync(path.join(project, '.cursor', 'custom.md'), 'utf8'),
      'keep me\n',
    )
    assert.equal(
      readFileSync(
        path.join(pancreatorDir, 'docs', 'target-repo-primer.md'),
        'utf8',
      ),
      'generated primer\n',
    )
    assert.equal(
      existsSync(path.join(pancreatorDir, 'runtime', 'target-repo-primer.md')),
      false,
    )
    assert.equal(
      existsSync(dispositionLayerPath),
      true,
      'a target disposition layer MUST survive a refresh',
    )
    assert.equal(
      readFileSync(path.join(briefSystemDirectory, 'project.json'), 'utf8'),
      '{"target":"custom-registry"}\n',
    )
    assert.equal(
      readFileSync(path.join(briefSystemDirectory, 'project.css'), 'utf8'),
      ':root { --target-token: 1; }\n',
    )
    assert.match(
      readFileSync(
        path.join(pancreatorDir, 'runtime', 'repository-checks.json'),
        'utf8',
      ),
      /python -m pytest/u,
    )
    assert.equal(readFileSync(legacyWorktreeNote, 'utf8'), 'legacy bytes\n')
    assert.equal(existsSync(path.join(pancreatorDir, 'worktrees')), true)

    assert.equal(
      existsSync(path.join(pancreatorDir, 'runtime', 'locks')),
      false,
    )
    assert.equal(existsSync(path.join(legacyRunDirectory, '.lock')), false)
    assert.equal(
      existsSync(path.join(legacyRunDirectory, retiredValidationName)),
      false,
    )
    assert.equal(
      existsSync(path.join(legacyRunDirectory, 'baseline.json')),
      false,
    )
    assert.equal(
      existsSync(path.join(retiredStateDirectory, retiredValidationName)),
      false,
    )
    assert.equal(
      existsSync(path.join(retiredStateDirectory, 'baseline.json')),
      false,
    )
    assert.equal(existsSync(legacyWorkspaceDirectory), false)
    assert.equal(existsSync(oldRunDirectory), false)
    assert.equal(existsSync(oldStateDirectory), false)
    assert.equal(
      existsSync(
        path.join(
          pancreatorDir,
          'runtime',
          'logs',
          'workflows',
          'archive',
          migratedOldRunId,
          'state.json',
        ),
      ),
      true,
    )
    assert.equal(
      existsSync(
        path.join(
          pancreatorDir,
          'runtime',
          'workflows',
          'archive',
          migratedOldRunId,
          'modifications.jsonl',
        ),
      ),
      true,
    )

    assert.equal(
      existsSync(
        path.join(pancreatorDir, 'governance', 'policies', 'OPERATOR-001.json'),
      ),
      true,
    )
    assert.equal(
      existsSync(path.join(project, '.cursor', 'commands', 'pan-repair.md')),
      true,
    )
    assert.equal(
      existsSync(
        path.join(project, '.cursor', 'agents', 'pan-harness-technician.md'),
      ),
      true,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('refresh removes only unmodified files from retired payload entries', () => {
  const project = cloneInstalledProject()
  const pancreatorDir = path.join(project, '.pancreator')
  const markerPath = path.join(pancreatorDir, 'install.json')
  const testsDirectory = path.join(pancreatorDir, 'tests', 'unit')
  const unmodifiedPath = path.join(testsDirectory, 'unmodified.test.ts')
  const modifiedPath = path.join(testsDirectory, 'modified.test.ts')
  const targetAddedPath = path.join(testsDirectory, 'target-added.test.ts')
  const shippedUnmodified = 'shipped unmodified\n'
  const shippedModified = 'shipped original\n'
  const localModified = 'local modification\n'
  const targetAdded = 'target addition\n'

  try {
    mkdirSync(testsDirectory, { recursive: true })
    writeFileSync(unmodifiedPath, shippedUnmodified)
    writeFileSync(modifiedPath, localModified)
    writeFileSync(targetAddedPath, targetAdded)

    const marker = readJson<InstallMarker>(markerPath)

    marker.payload_entries.push('tests')
    marker.payload_files.push(
      {
        path: 'tests/unit/unmodified.test.ts',
        sha256: createHash('sha256').update(shippedUnmodified).digest('hex'),
      },
      {
        path: 'tests/unit/modified.test.ts',
        sha256: createHash('sha256').update(shippedModified).digest('hex'),
      },
    )
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(unmodifiedPath), false)
    assert.equal(readFileSync(modifiedPath, 'utf8'), localModified)
    assert.equal(readFileSync(targetAddedPath, 'utf8'), targetAdded)
    assert.match(result.stdout, /retained  tests\/unit\/modified\.test\.ts/u)
    assert.match(
      result.stdout,
      /retained  tests\/unit\/target-added\.test\.ts/u,
    )
    assert.match(result.stdout, /retired  tests\/unit\/unmodified\.test\.ts/u)

    const backupRoot = path.join(
      pancreatorDir,
      'backups',
      'payload',
      readdirSync(path.join(pancreatorDir, 'backups', 'payload'))[0] ?? '',
    )

    assert.equal(
      readFileSync(
        path.join(backupRoot, 'tests', 'unit', 'modified.test.ts'),
        'utf8',
      ),
      localModified,
    )
    assert.equal(
      readFileSync(
        path.join(backupRoot, 'tests', 'unit', 'target-added.test.ts'),
        'utf8',
      ),
      targetAdded,
    )
    assert.equal(
      readJson<InstallMarker>(markerPath).payload_entries.includes('tests'),
      false,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})
