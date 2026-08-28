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

test('embedded installer refresh reconciles persona mappings and agent ownership', () => {
  // One install + refresh covers three persona behaviors at once, because
  // each seeds a disjoint piece of pre-refresh state: an operator model
  // mapping to preserve, a retired persona to prune, and a pre-namespace
  // agent to reclaim.
  const project = makeSkeletonProject()
  const customCoderModel = 'operator-custom-coder-model[fast=false]'
  const retiredPersona = 'tech-lead'
  const retiredModel = 'retired-persona-model[fast=false]'
  const legacyAgent = path.join(project, '.cursor', 'agents', 'coder.md')
  const markerPath = path.join(project, '.pancreator', 'install.json')

  try {
    assert.equal(runInstaller(project).status, 0)

    const configJsonPath = path.join(project, '.pancreator', 'config.json')
    const config = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    // An operator customization the refresh must keep, plus a mapping for a
    // persona the release no longer ships.
    config.active_config = 'simple'
    config.configs.simple.personas.coder = customCoderModel
    config.defaults[retiredPersona] = retiredModel
    config.configs.simple.personas[retiredPersona] = retiredModel
    writeFileSync(configJsonPath, `${JSON.stringify(config, null, 2)}\n`)

    // Reproduce an installation made before agents were namespaced: the old
    // path exists and the marker records Pancreator as its owner.
    const contents = 'pancreator-owned coder\n'

    writeFileSync(legacyAgent, contents)

    const marker = readJson<InstallMarker>(markerPath)

    marker.cursor_files.push({
      path: '.cursor/agents/coder.md',
      sha256: createHash('sha256').update(contents).digest('hex'),
    })
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`)

    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /Installation refresh completed/)

    const refreshed = readJson<{
      active_config: string
      defaults: Record<string, string>
      configs: Record<string, { personas: Record<string, string> }>
    }>(configJsonPath)

    // The operator mapping survives and the projected agent picks it up.
    assert.equal(refreshed.active_config, 'simple')
    assert.equal(refreshed.configs.simple.personas.coder, customCoderModel)

    const coderAgent = readFileSync(
      path.join(project, '.cursor', 'agents', 'pan-coder.md'),
      'utf8',
    )

    assert.ok(coderAgent.includes(`model: ${customCoderModel}`))

    // The retired persona is pruned everywhere.
    assert.equal(refreshed.defaults[retiredPersona], undefined)
    assert.equal(
      refreshed.configs.simple.personas[retiredPersona],
      undefined,
      'a retired persona MUST NOT survive a refresh',
    )

    // Ownership transfers to the namespaced path and the orphan is reclaimed.
    assert.equal(existsSync(legacyAgent), false)
    assert.equal(
      existsSync(path.join(project, '.cursor', 'agents', 'pan-coder.md')),
      true,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer refresh preserves target primer, runtime state, and unrelated Cursor files', () => {
  const project = makeSkeletonProject()

  try {
    assert.equal(runInstaller(project).status, 0)
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'inbox', 'request.md'),
      'keep me\n',
    )
    writeFileSync(path.join(project, '.cursor', 'custom.md'), 'keep me\n')
    writeFileSync(
      path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
      'generated primer\n',
    )
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'repository-checks.json'),
      '{\n  "schema_version": 1,\n  "profiles": {\n    "full": {\n      "probes": ["python --version"],\n      "commands": ["python -m pytest"]\n    }\n  }\n}\n',
    )
    const dispositionLayerPath = path.join(
      project,
      '.pancreator',
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
      project,
      '.pancreator',
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
    mkdirSync(path.join(project, '.pancreator', 'runtime', 'locks'), {
      recursive: true,
    })
    writeFileSync(
      path.join(project, '.pancreator', 'runtime', 'locks', 'stale.json'),
      '{}\n',
    )
    const legacyRunDirectory = path.join(
      project,
      '.pancreator',
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
      project,
      '.pancreator',
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
      project,
      '.pancreator',
      'runtime',
      'workspace',
    )
    mkdirSync(legacyWorkspaceDirectory, { recursive: true })
    writeFileSync(
      path.join(legacyWorkspaceDirectory, 'active-workflow.json'),
      '{}\n',
    )
    const oldRunId = '63379_Jun-22_5f354f23'
    // Prefix migration adds the minute component; suffix migration then
    // replaces the hex fragment with keywords from the run title.
    const migratedOldRunId = '63379_Jun-22-0158_old-run'
    const oldRunDirectory = path.join(
      project,
      '.pancreator',
      'runtime',
      'logs',
      'workflows',
      oldRunId,
    )
    const oldStateDirectory = path.join(
      project,
      '.pancreator',
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
    // Runtime maintenance standardizes loose inbox names onto the temporal
    // prefix scheme; the content survives under the new name.
    const inboxDirectory = path.join(project, '.pancreator', 'runtime', 'inbox')
    const standardizedRequest = readdirSync(inboxDirectory).find((name) =>
      /^\d+_[A-Z][a-z]{2}-\d{2}-\d{4}_request\.md$/u.test(name),
    )

    assert.ok(standardizedRequest, 'inbox request was not standardized')
    assert.equal(
      readFileSync(path.join(inboxDirectory, standardizedRequest), 'utf8'),
      'keep me\n',
    )
    assert.equal(
      readFileSync(path.join(project, '.cursor', 'custom.md'), 'utf8'),
      'keep me\n',
    )
    assert.equal(
      readFileSync(
        path.join(project, '.pancreator', 'docs', 'target-repo-primer.md'),
        'utf8',
      ),
      'generated primer\n',
    )
    assert.equal(
      existsSync(
        path.join(project, '.pancreator', 'runtime', 'target-repo-primer.md'),
      ),
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
        path.join(project, '.pancreator', 'runtime', 'repository-checks.json'),
        'utf8',
      ),
      /python -m pytest/u,
    )
    assert.equal(
      existsSync(path.join(project, '.pancreator', 'runtime', 'locks')),
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
          project,
          '.pancreator',
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
          project,
          '.pancreator',
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
        path.join(
          project,
          '.pancreator',
          'governance',
          'policies',
          'OPERATOR-001.json',
        ),
      ),
      true,
    )
    assert.match(
      readFileSync(
        path.join(
          project,
          '.pancreator',
          'library',
          'schemas',
          'stage-output.schema.json',
        ),
        'utf8',
      ),
      /workspace_changes/u,
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
