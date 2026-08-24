import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CURSOR_PROJECTION_TOKENS,
  projectCursorContent,
  renderPolicyCursorRule,
} from '../../src/lib/cursor-content.js'
import { loadPolicyCatalog } from '../../src/lib/policies.js'
import {
  projectPersonaVariants,
  removePersonaVariants,
  syncCursorProjection,
  validateProjectionDrift,
} from '../../src/lib/projection.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { resolveCursorModelSlug } from '../../src/lib/executors/cursor-catalog.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import { createFixture } from '../helpers.js'

test('embedded Cursor projection prefixes durable harness docs paths', () => {
  const { harnessPath } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Read \`${harnessPath}docs/target-repo-primer.md\` before running ` +
      `\`${harnessPath}library/skills/x.md\`.`,
    '.cursor/commands/pan-write-pr.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Read `.pancreator/docs/target-repo-primer.md` before running `.pancreator/library/skills/x.md`.',
  )
})

test('detached Cursor projection addresses the harness absolutely', () => {
  const { harnessPath, panCommand } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Read \`${harnessPath}docs/target-repo-primer.md\`, then run ` +
      `\`${panCommand} list --json\`.`,
    '.cursor/commands/pan-write-pr.md',
    'detached',
    '/opt/pancreator/acme',
  )

  assert.equal(
    projected,
    'Read `/opt/pancreator/acme/docs/target-repo-primer.md`, then run ' +
      '`/opt/pancreator/acme/bin/pan list --json`.',
  )
  // No relative path from the target can reach a detached harness.
  assert.doesNotMatch(projected, /\.pancreator/u)
  assert.doesNotMatch(projected, /`\.\/opt/u)
})

test('detached projection rewrites npm prefixes to the harness root', () => {
  const { npmPrefix } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Run \`npm${npmPrefix} run check\` and ` +
      `\`npm${npmPrefix} run validate\`.`,
    '.cursor/commands/pan-validate.md',
    'detached',
    '/opt/pancreator/acme',
  )

  assert.equal(
    projected,
    'Run `npm --prefix /opt/pancreator/acme run check` and ' +
      '`npm --prefix /opt/pancreator/acme run validate`.',
  )
})

test('self-development projection is never rewritten', () => {
  const { harnessPath, panCommand } = CURSOR_PROJECTION_TOKENS
  const source =
    `Read \`${harnessPath}docs/x.md\`, then run ` +
    `\`${panCommand} list --json\`.`

  assert.equal(
    projectCursorContent(
      source,
      '.cursor/commands/pan-status.md',
      'self_development',
    ),
    'Read `docs/x.md`, then run `./bin/pan list --json`.',
  )
})

test('embedded build-docs projection preserves harness-relative CLI targets', () => {
  const { cliPath, panCommand } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Run \`${panCommand} requirements run --target ` +
      `${cliPath}docs/target-repo-primer.md\`.`,
    '.cursor/commands/pan-build-docs.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Run `./.pancreator/bin/pan requirements run --target docs/target-repo-primer.md`.',
  )
})

test('embedded repair projection writes the intake under the installed harness', () => {
  const { cliPath, harnessPath, panCommand } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Choose an output path under \`${harnessPath}runtime/inbox/\`, then run ` +
      `\`${panCommand} requirements run --target ` +
      `${cliPath}runtime/inbox/repair.md\`.`,
    '.cursor/commands/pan-repair.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Choose an output path under `.pancreator/runtime/inbox/`, then run `./.pancreator/bin/pan requirements run --target runtime/inbox/repair.md`.',
  )
})

test('embedded release projection resolves the harness config before stopping', () => {
  const { harnessPath, panCommand } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Read \`${harnessPath}config.json\`, ` +
      `\`${harnessPath}docs/target-repo-primer.md\`, and ` +
      `\`${harnessPath}library/skills/update-release-metadata.md\`, then run ` +
      `\`${panCommand} list --json\`.`,
    '.cursor/commands/pan-release.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Read `.pancreator/config.json`, `.pancreator/docs/target-repo-primer.md`, and `.pancreator/library/skills/update-release-metadata.md`, then run `./.pancreator/bin/pan list --json`.',
  )
})

test('projection rejects unresolved path tokens', () => {
  assert.throws(
    () =>
      projectCursorContent(
        'Read `{{PANCREATOR_UNKNOWN_PATH}}file.md`.',
        '.cursor/commands/pan-status.md',
        'embedded',
      ),
    /contains unresolved projection tokens/u,
  )
})

test('projection drift validation runs on fixture repository', () => {
  const root = createFixture()
  const result = validateProjectionDrift(root)

  assert.equal(typeof result.regeneration_command, 'string')
  assert.deepEqual(result.errors, [])
})

test('repository validation does not require a local Cursor projection', () => {
  const root = createFixture()

  rmSync(path.join(root, '.cursor'), { recursive: true, force: true })

  const result = validateProjectionDrift(root)

  assert.deepEqual(result.errors, [])
})

test('installer and compiled projection renderers stay byte-identical', () => {
  const root = createFixture()
  const targetRoot = mkdtempSync(
    path.join(tmpdir(), 'pancreator-installer-projection-'),
  )
  const policy = loadPolicyCatalog(root).get('BROWSER-001')

  assert.ok(policy)

  try {
    const result = spawnSync(
      process.execPath,
      [
        path.join(process.cwd(), 'bin', 'install-support'),
        'project-cursor',
        '--source-root',
        root,
        '--target-root',
        targetRoot,
        '--manifest-out',
        path.join(targetRoot, 'cursor-manifest.json'),
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
      },
    )

    assert.equal(result.status, 0, result.stderr)

    const installerRendered = readFileSync(
      path.join(targetRoot, '.cursor', 'rules', 'pan-browser-isolation.mdc'),
      'utf8',
    )

    assert.equal(installerRendered, renderPolicyCursorRule(policy))

    const commandSource = readFileSync(
      path.join(root, 'library', 'cursor', 'commands', 'pan-status.md'),
      'utf8',
    )
    const installerCommand = readFileSync(
      path.join(targetRoot, '.cursor', 'commands', 'pan-status.md'),
      'utf8',
    )

    assert.equal(
      installerCommand,
      projectCursorContent(
        commandSource,
        '.cursor/commands/pan-status.md',
        'embedded',
      ),
    )
  } finally {
    rmSync(targetRoot, { recursive: true, force: true })
  }
})

test('Cursor sync projects the intake writer agent with its resolved model', () => {
  const root = createFixture()
  const activeModel = loadPipelineConfig(root).config.personas['intake-writer']

  assert.ok(activeModel)
  const activeSlug = resolveCursorModelSlug(parsePersonaMapping(activeModel))
  syncCursorProjection(root, { write: true })

  const projected = readFileSync(
    path.join(root, '.cursor', 'agents', 'pan-intake-writer.md'),
    'utf8',
  )

  assert.match(
    projected,
    new RegExp(
      `^model: ${activeSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'mu',
    ),
  )
  assert.match(projected, /library\/personas\/intake-writer\.md/u)
  assert.deepEqual(validateProjectionDrift(root).errors, [])
})

test('Cursor sync projects the meta-orchestrator start surface', () => {
  const root = createFixture()
  const activeModel =
    loadPipelineConfig(root).config.personas['meta-orchestrator']

  assert.ok(activeModel)
  syncCursorProjection(root, { write: true })

  const projected = readFileSync(
    path.join(root, '.cursor', 'agents', 'pan-meta-orchestrator.md'),
    'utf8',
  )

  assert.match(projected, /library\/personas\/meta-orchestrator\.md/u)
  assert.match(projected, /best-of-n init/u)
  assert.match(projected, /directly supervises every session run/u)
  assert.match(
    projected,
    /MUST NOT delegate a child run to `pan-orchestrator`/u,
  )
  assert.doesNotMatch(projected, /operator's top-level agent/u)
})

test('workflow QA keeps the supervisor in the top-level session', () => {
  const root = createFixture()

  syncCursorProjection(root, { write: true })

  const projected = readFileSync(
    path.join(root, '.cursor', 'commands', 'pan-qa-workflow.md'),
    'utf8',
  )

  assert.match(projected, /Adopt both persona briefs in this session/u)
  assert.match(projected, /Continue each supervisor-owned action/u)
  assert.doesNotMatch(
    projected,
    /Invoke the `pan-harness-workflow-qa` subagent/u,
  )
})

test('standalone persona commands expose the shared worktree option', () => {
  const root = createFixture()

  syncCursorProjection(root, { write: true })

  for (const command of [
    'pan-debug',
    'pan-decompose',
    'pan-pair',
    'pan-repair',
    'pan-shepherd',
    'pan-spotfix',
  ]) {
    const projected = readFileSync(
      path.join(root, '.cursor', 'commands', `${command}.md`),
      'utf8',
    )

    assert.match(projected, /--worktree <name>/u, command)
  }
})

test('workflow start and persona utility surfaces expose worktree selection', () => {
  const root = createFixture()

  syncCursorProjection(root, { write: true })

  // `/pan-start` creates the run, so worktree selection must be visible there.
  // It used to live on the orchestrator agent, which no longer starts runs.
  const start = readFileSync(
    path.join(root, '.cursor', 'commands', 'pan-start.md'),
    'utf8',
  )

  assert.match(start, /--worktree <name>/u)

  for (const command of [
    'pan-build-briefs',
    'pan-build-docs',
    'pan-release',
    'pan-write-pr',
  ]) {
    const projected = readFileSync(
      path.join(root, '.cursor', 'commands', `${command}.md`),
      'utf8',
    )

    assert.match(projected, /--worktree <name>/u, command)
    assert.match(projected, /worktree resolve <name>/u, command)
  }
})

test('a stored variant effort reaches the agent file unchanged', () => {
  // A stored best-of-N variant map is that candidate's execution contract. The
  // harness rewrote reasoning=xhigh to effort=xhigh on the way to the agent
  // file Cursor reads, so a candidate ran under a value nobody recorded. The
  // spec must reach the frontmatter byte-identical.
  const root = createFixture()

  projectPersonaVariants(
    root,
    'bondeadbeef-verbatim',
    { coder: 'gpt-5.6-sol[context=272k,reasoning=xhigh,fast=true]' },
    { write: true },
  )

  const projected = readFileSync(
    path.join(root, '.cursor', 'agents', 'pan-coder--bondeadbeef-verbatim.md'),
    'utf8',
  )

  assert.equal(
    /^model: (.+)$/mu.exec(projected)?.[1],
    'gpt-5.6-sol[context=272k,reasoning=xhigh,fast=true]',
  )
})

test('run-scoped agent variants carry pinned models without touching the base agents', () => {
  const root = createFixture()
  const baseCoderPath = path.join(root, '.cursor', 'agents', 'pan-coder.md')
  const baseCoder = readFileSync(baseCoderPath, 'utf8')

  const changes = projectPersonaVariants(
    root,
    'bondeadbeef-alpha',
    {
      coder: 'gpt-5.4[context=272k,reasoning=high,fast=false]',
      reviewer: 'claude-opus-5',
    },
    { write: true },
  )

  assert.deepEqual(
    changes.map((change) => change.path),
    [
      '.cursor/agents/pan-coder--bondeadbeef-alpha.md',
      '.cursor/agents/pan-reviewer--bondeadbeef-alpha.md',
    ],
  )
  // Frontmatter carries the configured spec verbatim in Cursor's documented
  // bracket grammar.
  assert.match(
    readFileSync(
      path.join(root, '.cursor', 'agents', 'pan-coder--bondeadbeef-alpha.md'),
      'utf8',
    ),
    /^model: gpt-5\.4\[context=272k,reasoning=high,fast=false\]$/mu,
  )
  assert.equal(readFileSync(baseCoderPath, 'utf8'), baseCoder)

  // A variant is run-scoped generated state, so it is not active-config drift.
  assert.deepEqual(validateProjectionDrift(root).errors, [])

  assert.deepEqual(removePersonaVariants(root, 'bondeadbeef-alpha'), [
    'pan-coder--bondeadbeef-alpha.md',
    'pan-reviewer--bondeadbeef-alpha.md',
  ])
  assert.equal(
    existsSync(
      path.join(root, '.cursor', 'agents', 'pan-coder--bondeadbeef-alpha.md'),
    ),
    false,
  )
})

test('a variant suffix that a Cursor filename cannot carry is rejected', () => {
  const root = createFixture()

  assert.throws(
    () => projectPersonaVariants(root, 'Alpha One', { coder: 'model' }),
    /MUST be lowercase alphanumeric/u,
  )
  assert.throws(
    () => projectPersonaVariants(root, 'alpha--one', { coder: 'model' }),
    /MUST be lowercase alphanumeric/u,
  )
})

test('Cursor sync renders ignored local files from canonical library sources', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'pan-coder.md')
  const sourcePath = path.join(root, 'library', 'cursor', 'agents', 'coder.md')
  const activeModel = loadPipelineConfig(root).config.personas.coder
  const activeSlug = resolveCursorModelSlug(parsePersonaMapping(activeModel))
  const stale = readFileSync(agentPath, 'utf8').replace(
    /^model:.*$/mu,
    'model: intentionally-wrong',
  )

  writeFileSync(agentPath, stale)

  const preview = syncCursorProjection(root)
  const coder = preview.find((entry) => entry.path.endsWith('/pan-coder.md'))

  assert.equal(coder?.id, 'cursor-agents')
  assert.equal(coder?.changed, true)

  syncCursorProjection(root, { write: true })

  assert.match(
    readFileSync(agentPath, 'utf8'),
    new RegExp(
      `^model: ${activeSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'mu',
    ),
  )
  assert.match(readFileSync(sourcePath, 'utf8'), /__PANCREATOR_MODEL__/u)
})
