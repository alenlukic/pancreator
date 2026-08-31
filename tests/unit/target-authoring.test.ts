import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { buildGovernanceCard } from '../../src/lib/governance-card.js'
import { resolvePolicies } from '../../src/lib/policies.js'
import {
  applyTargetAuthoringDraft,
  readTargetExtensionManifest,
  validateTargetAuthoring,
} from '../../src/lib/target-authoring.js'
import { createFixture, writeJson } from '../helpers.js'

interface TargetFixture {
  root: string
  target: string
}

function createTargetFixture(
  mode: 'embedded' | 'detached' = 'embedded',
): TargetFixture {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as Record<
    string,
    unknown
  >
  const target =
    mode === 'embedded' ? path.join(root, 'target') : `${root}-target`

  config.installation_mode = mode
  config.workspace_root = mode === 'embedded' ? 'target' : target
  writeJson(configPath, config)

  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'README.md'), '# target\n')
  writeFileSync(path.join(target, 'tsconfig.json'), '{}\n')
  writeFileSync(path.join(target, '.gitignore'), 'local-cache/\n')
  execFileSync('git', ['init', '-q'], { cwd: target })
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], {
    cwd: target,
  })
  execFileSync('git', ['config', 'user.name', 'Fixture'], { cwd: target })
  execFileSync('git', ['add', '.'], { cwd: target })
  execFileSync('git', ['commit', '-qm', 'target'], { cwd: target })

  return { root, target }
}

function cleanupTargetFixture(fixture: TargetFixture): void {
  rmSync(fixture.root, { recursive: true, force: true })

  if (!fixture.target.startsWith(`${fixture.root}${path.sep}`)) {
    rmSync(fixture.target, { recursive: true, force: true })
  }
}

function commandDraft(extensionId: string): Record<string, unknown> {
  return {
    schema_version: 1,
    extension_id: extensionId,
    kind: 'command',
    title: 'Acme command',
    summary: 'Run one target command.',
    content:
      `# Acme command\n\nUse $ARGUMENTS.\n\n` +
      `1. Run \`{{PANCREATOR_PAN_COMMAND}} governance card --mode target --extension ${extensionId}\`.\n`,
    policy_persona: 'coder',
    policies: [],
  }
}

function applyDraft(
  root: string,
  draft: Record<string, unknown>,
): ReturnType<typeof applyTargetAuthoringDraft> {
  const input = `runtime/inbox/target-authoring/${String(draft.extension_id)}.json`

  writeJson(path.join(root, input), draft)

  return applyTargetAuthoringDraft(root, input)
}

test('target authoring publishes every artifact kind with resolved governance', () => {
  const fixture = createTargetFixture()
  const { root, target } = fixture

  try {
    const command = applyDraft(root, commandDraft('acme-tool'))
    const skill = applyDraft(root, {
      schema_version: 1,
      extension_id: 'acme-skill',
      kind: 'skill',
      title: 'Acme skill',
      summary: 'Apply the target skill.',
      content: '# Acme skill\n\n## Procedure\n\nApply the target procedure.\n',
      policy_persona: 'coder',
      policies: ['REPO-001'],
    })
    const persona = applyDraft(root, {
      schema_version: 1,
      extension_id: 'acme-persona',
      kind: 'persona',
      title: 'Acme persona',
      summary: 'Run the target persona.',
      content:
        '# Acme persona\n\n## Responsibilities\n\n- Preserve the target.\n\n' +
        '## Boundaries\n\n- Do not change unrelated files.\n',
      policy_persona: 'coder',
      policies: [],
      model: 'gpt-5.6-sol',
    })

    assert.equal(command.status, 'applied')
    assert.equal(skill.projection_path, null)
    assert.equal(persona.projection_path, '.cursor/agents/acme-persona.md')

    const manifest = readTargetExtensionManifest(root, 'acme-tool')

    for (const policyId of ['CONTRACT-001', 'ENG-001', 'REPO-001', 'TS-001']) {
      assert.ok(manifest.policies.includes(policyId), policyId)
    }

    const resolved = resolvePolicies(root, {
      ...manifest.context,
      operator_artifacts: 'suppressed',
    }).map((policy) => policy.id)

    assert.deepEqual(resolved, manifest.policies)
    assert.ok(
      existsSync(path.join(target, '.cursor', 'commands', 'acme-tool.md')),
    )
    assert.ok(
      existsSync(path.join(target, '.cursor', 'agents', 'acme-persona.md')),
    )
    assert.ok(
      existsSync(path.join(root, 'target-extensions/acme-persona/agent.md')),
    )
    assert.doesNotMatch(
      readFileSync(path.join(root, 'config.json'), 'utf8'),
      /acme-persona/u,
    )
    assert.equal(
      readFileSync(path.join(target, '.gitignore'), 'utf8'),
      'local-cache/\n',
    )
    assert.equal(
      execFileSync('git', ['status', '--porcelain'], {
        cwd: target,
        encoding: 'utf8',
      }),
      '',
    )

    const exclude = readFileSync(path.join(target, '.git/info/exclude'), 'utf8')

    assert.match(exclude, /\/\.cursor\/commands\/acme-tool\.md/u)
    assert.match(exclude, /\/\.cursor\/agents\/acme-persona\.md/u)

    const card = buildGovernanceCard(root, {
      mode: 'target',
      extensionId: 'acme-tool',
      outputPath: 'runtime/inbox/acme-tool-card.md',
    })

    assert.deepEqual(
      card.policies.map((policy) => policy.id),
      manifest.policies,
    )
    assert.doesNotMatch(card.markdown, /read .*governance\/policies\//iu)
  } finally {
    cleanupTargetFixture(fixture)
  }
})

test('target authoring publishes every artifact kind when detached', () => {
  const fixture = createTargetFixture('detached')
  const { root, target } = fixture

  try {
    const command = applyDraft(root, commandDraft('detached-command'))
    const skill = applyDraft(root, {
      schema_version: 1,
      extension_id: 'detached-skill',
      kind: 'skill',
      title: 'Detached skill',
      summary: 'Apply one detached skill.',
      content: '# Detached skill\n\n## Procedure\n\nApply the procedure.\n',
      policy_persona: 'coder',
      policies: [],
    })
    const persona = applyDraft(root, {
      schema_version: 1,
      extension_id: 'detached-persona',
      kind: 'persona',
      title: 'Detached persona',
      summary: 'Run one detached persona.',
      content:
        '# Detached persona\n\n## Responsibilities\n\n- Preserve the target.\n\n' +
        '## Boundaries\n\n- Stay inside the request.\n',
      policy_persona: 'coder',
      policies: [],
      model: 'gpt-5.6-sol',
    })

    assert.equal(command.status, 'applied')
    assert.equal(skill.status, 'applied')
    assert.equal(persona.status, 'applied')
    assert.ok(
      existsSync(path.join(target, '.cursor/commands/detached-command.md')),
    )
    assert.ok(
      existsSync(path.join(target, '.cursor/agents/detached-persona.md')),
    )
  } finally {
    cleanupTargetFixture(fixture)
  }
})

test('target authoring is idempotent and rejects stale or reserved updates', () => {
  const fixture = createTargetFixture()
  const { root, target } = fixture

  try {
    const firstDraft = commandDraft('acme-tool')
    const first = applyDraft(root, firstDraft)
    const second = applyDraft(root, firstDraft)

    assert.equal(second.status, 'unchanged')
    assert.equal(second.manifest_sha256, first.manifest_sha256)

    const changed = {
      ...firstDraft,
      summary: 'Run the changed target command.',
      content:
        '# Acme command\n\nUse $ARGUMENTS.\n\n' +
        '1. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode target --extension acme-tool`.\n' +
        '2. Report the changed result.\n',
    }

    assert.throws(
      () => applyDraft(root, changed),
      (error: unknown) =>
        error instanceof PanError &&
        error.code === 'STALE_TARGET_AUTHORING_DRAFT',
    )

    const replaced = applyDraft(root, {
      ...changed,
      expected_manifest_sha256: first.manifest_sha256,
    })

    assert.equal(replaced.status, 'applied')
    assert.notEqual(replaced.manifest_sha256, first.manifest_sha256)

    assert.throws(
      () => applyDraft(root, commandDraft('pan-tool')),
      (error: unknown) =>
        error instanceof PanError && error.code === 'RESERVED_TARGET_EXTENSION',
    )
    assert.equal(
      existsSync(path.join(target, '.cursor/commands/pan-tool.md')),
      false,
    )
  } finally {
    cleanupTargetFixture(fixture)
  }
})

test('target authoring validation restores derived files from canonical content', () => {
  const fixture = createTargetFixture()
  const { root, target } = fixture

  try {
    applyDraft(root, commandDraft('acme-tool'))
    applyDraft(root, {
      schema_version: 1,
      extension_id: 'acme-persona',
      kind: 'persona',
      title: 'Acme persona',
      summary: 'Run the target persona.',
      content:
        '# Acme persona\n\n## Responsibilities\n\n- Preserve the target.\n\n' +
        '## Boundaries\n\n- Stay inside the request.\n',
      policy_persona: 'coder',
      policies: [],
      model: 'gpt-5.6-sol',
    })

    const projection = path.join(target, '.cursor/commands/acme-tool.md')
    const agent = path.join(root, 'target-extensions/acme-persona/agent.md')
    const exclude = path.join(target, '.git/info/exclude')

    rmSync(projection)
    rmSync(agent)
    writeFileSync(exclude, '# local excludes\n')
    assert.equal(validateTargetAuthoring(root).ok, false)
    assert.equal(validateTargetAuthoring(root, { repair: true }).ok, true)
    assert.equal(existsSync(projection), true)
    assert.equal(existsSync(agent), true)
    assert.match(
      readFileSync(exclude, 'utf8'),
      /\/\.cursor\/commands\/acme-tool\.md/u,
    )
  } finally {
    cleanupTargetFixture(fixture)
  }
})

test('target authoring rejects manifest path escape attempts', () => {
  const fixture = createTargetFixture()
  const { root } = fixture

  try {
    applyDraft(root, commandDraft('acme-tool'))

    const manifestPath = path.join(
      root,
      'target-extensions/acme-tool/manifest.json',
    )
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<
      string,
      unknown
    >

    manifest.content_path = '../outside.md'
    writeJson(manifestPath, manifest)

    const result = validateTargetAuthoring(root)

    assert.equal(result.ok, false)
    assert.match(result.errors.join('\n'), /content_path MUST be/u)
  } finally {
    cleanupTargetFixture(fixture)
  }
})
