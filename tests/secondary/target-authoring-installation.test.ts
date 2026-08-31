import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  REPO_ROOT,
  createReleaseFixture,
  git,
  makeSkeletonProject,
  readJson,
  run,
} from './install-helpers.js'

function digest(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

test('target extensions survive refresh repair and indexed update while clean leaves inert Cursor copies', () => {
  const source = createReleaseFixture()
  const project = makeSkeletonProject()

  try {
    const install = run(
      path.join(source, 'bin', 'install'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.equal(install.status, 0, install.stderr)

    const harness = path.join(project, '.pancreator')
    const drafts = [
      {
        schema_version: 1,
        extension_id: 'acme-tool',
        kind: 'command',
        title: 'Acme tool',
        summary: 'Run the Acme tool.',
        content:
          '# Acme tool\n\nUse $ARGUMENTS.\n\n' +
          '1. Run `{{PANCREATOR_PAN_COMMAND}} governance card --mode target --extension acme-tool`.\n',
        policy_persona: 'coder',
        policies: ['REPO-001'],
      },
      {
        schema_version: 1,
        extension_id: 'acme-skill',
        kind: 'skill',
        title: 'Acme skill',
        summary: 'Apply the Acme skill.',
        content:
          '# Acme skill\n\n## Procedure\n\nApply the target procedure.\n',
        policy_persona: 'coder',
        policies: ['REPO-001'],
      },
      {
        schema_version: 1,
        extension_id: 'acme-persona',
        kind: 'persona',
        title: 'Acme persona',
        summary: 'Run the Acme persona.',
        content:
          '# Acme persona\n\n## Responsibilities\n\n- Preserve the target.\n\n' +
          '## Boundaries\n\n- Stay inside the request.\n',
        policy_persona: 'coder',
        policies: ['REPO-001'],
        model: 'gpt-5.6-sol',
      },
    ]

    for (const draft of drafts) {
      const input = `runtime/inbox/${draft.extension_id}.json`

      writeFileSync(
        path.join(harness, input),
        `${JSON.stringify(draft, null, 2)}\n`,
      )

      const apply = run(
        process.execPath,
        [
          path.join(REPO_ROOT, 'dist/src/cli.js'),
          'author',
          'apply',
          '--input',
          input,
          '--json',
        ],
        harness,
      )

      assert.equal(apply.status, 0, `${apply.stdout}\n${apply.stderr}`)
    }

    const marker = readJson<{
      cursor_files: Array<{ path: string }>
    }>(path.join(harness, 'install.json'))

    assert.equal(
      marker.cursor_files.some((entry) =>
        /acme-(tool|persona)/u.test(entry.path),
      ),
      false,
    )

    const paths = [
      path.join(harness, 'target-extensions/acme-tool/manifest.json'),
      path.join(harness, 'target-extensions/acme-tool/command.md'),
      path.join(
        harness,
        'governance/registries/policy_lookup.d/acme-tool.json',
      ),
      path.join(project, '.cursor/commands/acme-tool.md'),
      path.join(harness, 'target-extensions/acme-skill/manifest.json'),
      path.join(harness, 'target-extensions/acme-skill/skill.md'),
      path.join(
        harness,
        'governance/registries/policy_lookup.d/acme-skill.json',
      ),
      path.join(harness, 'target-extensions/acme-persona/manifest.json'),
      path.join(harness, 'target-extensions/acme-persona/persona.md'),
      path.join(harness, 'target-extensions/acme-persona/agent.md'),
      path.join(
        harness,
        'governance/registries/policy_lookup.d/acme-persona.json',
      ),
      path.join(project, '.cursor/agents/acme-persona.md'),
    ]
    const extensionIds = drafts.map((draft) => draft.extension_id)
    const resolvePolicyIds = (): string[][] =>
      extensionIds.map((extensionId) => {
        const result = run(
          process.execPath,
          [
            path.join(REPO_ROOT, 'dist/src/cli.js'),
            'governance',
            'card',
            '--mode',
            'target',
            '--extension',
            extensionId,
            '--out',
            `runtime/inbox/${extensionId}-card.md`,
            '--json',
          ],
          harness,
        )

        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)

        return (
          JSON.parse(result.stdout) as {
            policies: string[]
          }
        ).policies
      })
    const before = paths.map(digest)
    const beforePolicies = resolvePolicyIds()

    for (const mode of ['--yes', '--repair']) {
      const result = run(
        path.join(source, 'bin', 'install'),
        [
          '--target',
          project,
          '--skip-dependencies',
          '--skip-shell-alias',
          mode,
        ],
        source,
      )

      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(paths.map(digest), before)
      assert.deepEqual(resolvePolicyIds(), beforePolicies)
    }

    writeFileSync(path.join(source, 'VERSION'), '0.2.0\n')
    writeFileSync(path.join(source, 'README.md'), '# release 0.2.0\n')
    git(source, ['add', 'VERSION', 'README.md'])
    git(source, ['commit', '-qm', 'release 0.2.0'])

    const releaseCommit = git(source, ['rev-parse', 'HEAD'])
    const releaseIndexPath = path.join(source, 'release/index.json')
    const releaseIndex = readJson<{
      schema_version: 1
      releases: Array<{ version: string; commit: string }>
    }>(releaseIndexPath)

    releaseIndex.releases.push({
      version: '0.2.0',
      commit: releaseCommit,
    })
    writeFileSync(
      releaseIndexPath,
      `${JSON.stringify(releaseIndex, null, 2)}\n`,
    )
    git(source, ['add', 'release/index.json'])
    git(source, ['commit', '-qm', 'index 0.2.0'])

    const update = run(
      path.join(source, 'bin', 'update'),
      ['--target', project, '--skip-dependencies', '--skip-shell-alias'],
      source,
    )

    assert.equal(update.status, 0, update.stderr)
    assert.deepEqual(paths.map(digest), before)
    assert.deepEqual(resolvePolicyIds(), beforePolicies)

    const clean = run(
      path.join(source, 'bin', 'install'),
      [
        '--target',
        project,
        '--clean',
        '--skip-dependencies',
        '--skip-shell-alias',
      ],
      source,
    )

    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /retains these foreign Cursor files as inert/u)
    assert.match(clean.stdout, /\.cursor\/commands\/acme-tool\.md/u)
    assert.match(clean.stdout, /\.cursor\/agents\/acme-persona\.md/u)
    assert.equal(existsSync(paths[0] ?? ''), false)
    assert.equal(existsSync(paths[2] ?? ''), false)
    assert.equal(existsSync(paths[3] ?? ''), true)
    assert.equal(
      existsSync(
        path.join(harness, 'target-extensions/acme-skill/manifest.json'),
      ),
      false,
    )
    assert.equal(
      existsSync(
        path.join(
          harness,
          'governance/registries/policy_lookup.d/acme-persona.json',
        ),
      ),
      false,
    )
    assert.equal(
      existsSync(path.join(project, '.cursor/agents/acme-persona.md')),
      true,
    )
  } finally {
    rmSync(source, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
})
