import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CURSOR_PROJECTION_TOKENS,
  projectCursorContent,
} from '../../src/lib/cursor-content.js'
import {
  isPancreatorOwnedCursorBasename,
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
  const { cliPath, harnessPath, panCommand } = CURSOR_PROJECTION_TOKENS
  // CLI targets stay harness-relative because the binary already runs from the
  // harness root.
  const projected = projectCursorContent(
    `Read \`${harnessPath}docs/target-repo-primer.md\` before running ` +
      `\`${harnessPath}library/skills/x.md\`. ` +
      `Choose an output path under \`${harnessPath}runtime/inbox/\`, then run ` +
      `\`${panCommand} requirements run --target ` +
      `${cliPath}runtime/inbox/repair.md\` and ` +
      `\`${panCommand} requirements run --target ` +
      `${cliPath}docs/target-repo-primer.md\`.`,
    '.cursor/commands/pan-write-pr.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Read `.pancreator/docs/target-repo-primer.md` before running `.pancreator/library/skills/x.md`. ' +
      'Choose an output path under `.pancreator/runtime/inbox/`, then run ' +
      '`./.pancreator/bin/pan requirements run --target runtime/inbox/repair.md` and ' +
      '`./.pancreator/bin/pan requirements run --target docs/target-repo-primer.md`.',
  )
})

test('detached Cursor projection addresses the harness absolutely', () => {
  const { harnessPath, npmPrefix, panCommand } = CURSOR_PROJECTION_TOKENS
  const projected = projectCursorContent(
    `Read \`${harnessPath}docs/target-repo-primer.md\`, then run ` +
      `\`${panCommand} list --json\` and \`npm${npmPrefix} run check\`.`,
    '.cursor/commands/pan-write-pr.md',
    'detached',
    '/opt/pancreator/acme',
  )

  assert.equal(
    projected,
    'Read `/opt/pancreator/acme/docs/target-repo-primer.md`, then run ' +
      '`/opt/pancreator/acme/bin/pan list --json` and ' +
      '`npm --prefix /opt/pancreator/acme run check`.',
  )
  // No relative path from the target can reach a detached harness.
  assert.doesNotMatch(projected, /\.pancreator/u)
  assert.doesNotMatch(projected, /`\.\/opt/u)
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

test('target extensions can reuse the unchanged Cursor ownership predicate', () => {
  assert.equal(isPancreatorOwnedCursorBasename('pan-tool.md'), true)
  assert.equal(isPancreatorOwnedCursorBasename('pancreator.tool.md'), true)
  assert.equal(isPancreatorOwnedCursorBasename('acme-tool.md'), false)
})

test('repository validation does not require a local Cursor projection', () => {
  const root = createFixture()

  rmSync(path.join(root, '.cursor'), { recursive: true, force: true })

  const result = validateProjectionDrift(root)

  assert.deepEqual(result.errors, [])
})

test('run-scoped agent variants carry pinned models without touching the base agents', () => {
  const root = createFixture()
  const baseCoderPath = path.join(root, '.cursor', 'agents', 'pan-coder.md')
  const baseCoder = readFileSync(baseCoderPath, 'utf8')

  // The variant spec must reach the frontmatter byte-identical.
  const coderSpec = 'gpt-5.6-sol[context=272k,reasoning=xhigh,fast=true]'
  const changes = projectPersonaVariants(
    root,
    'bondeadbeef-alpha',
    {
      coder: coderSpec,
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
  assert.equal(
    /^model: (.+)$/mu.exec(
      readFileSync(
        path.join(root, '.cursor', 'agents', 'pan-coder--bondeadbeef-alpha.md'),
        'utf8',
      ),
    )?.[1],
    coderSpec,
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
  const personas = loadPipelineConfig(root).config.personas
  const activeModel = personas.coder
  const activeSlug = resolveCursorModelSlug(parsePersonaMapping(activeModel))
  const plannerModel = personas.planner

  assert.ok(plannerModel)

  const plannerSlug = resolveCursorModelSlug(parsePersonaMapping(plannerModel))
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

  const planner = readFileSync(
    path.join(root, '.cursor', 'agents', 'pan-planner.md'),
    'utf8',
  )

  assert.match(
    planner,
    new RegExp(
      `^model: ${plannerSlug.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'mu',
    ),
  )
  assert.match(planner, /library\/personas\/planner\.md/u)
  assert.deepEqual(validateProjectionDrift(root).errors, [])
})
