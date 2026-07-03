import assert from 'node:assert/strict'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { projectCursorContent } from '../../src/lib/cursor-content.js'
import {
  syncCursorProjection,
  validateProjectionDrift,
} from '../../src/lib/projection.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { createFixture } from '../helpers.js'

test('embedded Cursor projection prefixes durable harness docs paths', () => {
  const projected = projectCursorContent(
    'Read `docs/target-repo-primer.md` before running `library/skills/x.md`.',
    '.cursor/commands/pan-write-pr.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Read `.pancreator/docs/target-repo-primer.md` before running `.pancreator/library/skills/x.md`.',
  )
})

test('embedded build-docs projection preserves harness-relative CLI targets', () => {
  const projected = projectCursorContent(
    'Run `./bin/pan requirements run --target docs/target-repo-primer.md`.',
    '.cursor/commands/pan-build-docs.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Run `./.pancreator/bin/pan requirements run --target docs/target-repo-primer.md`.',
  )
})

test('embedded repair projection writes the intake under the installed harness', () => {
  const projected = projectCursorContent(
    'Choose an output path under `runtime/inbox/`, then run `./bin/pan requirements run --target runtime/inbox/repair.md`.',
    '.cursor/commands/pan-repair.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Choose an output path under `.pancreator/runtime/inbox/`, then run `./.pancreator/bin/pan requirements run --target runtime/inbox/repair.md`.',
  )
})

test('embedded release projection resolves the harness config before stopping', () => {
  const projected = projectCursorContent(
    'Read `project.json`, `docs/target-repo-primer.md`, and `library/skills/update-release-metadata.md`, then run `./bin/pan list --json`.',
    '.cursor/commands/pan-release.md',
    'embedded',
  )

  assert.equal(
    projected,
    'Read `.pancreator/project.json`, `.pancreator/docs/target-repo-primer.md`, and `.pancreator/library/skills/update-release-metadata.md`, then run `./.pancreator/bin/pan list --json`.',
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

test('Cursor sync renders ignored local files from canonical library sources', () => {
  const root = createFixture()
  const agentPath = path.join(root, '.cursor', 'agents', 'coder.md')
  const sourcePath = path.join(root, 'library', 'cursor', 'agents', 'coder.md')
  const activeModel = loadPipelineConfig(root).config.personas.coder
  const stale = readFileSync(agentPath, 'utf8').replace(
    /^model:.*$/mu,
    'model: intentionally-wrong',
  )

  writeFileSync(agentPath, stale)

  const preview = syncCursorProjection(root)
  const coder = preview.find((entry) => entry.path.endsWith('/coder.md'))

  assert.equal(coder?.id, 'cursor-agents')
  assert.equal(coder?.changed, true)

  syncCursorProjection(root, { write: true })

  assert.match(
    readFileSync(agentPath, 'utf8'),
    new RegExp(
      `^model: ${activeModel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`,
      'mu',
    ),
  )
  assert.match(readFileSync(sourcePath, 'utf8'), /__PANCREATOR_MODEL__/u)
})
