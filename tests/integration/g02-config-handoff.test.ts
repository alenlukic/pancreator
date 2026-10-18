import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import { loadPipelineConfig } from '../../src/lib/pipeline-config.js'
import { handoffSelfDevelopmentLocalConfig } from '../../src/lib/worktree/store.js'
import { createWorktree } from '../../src/lib/worktrees.js'
import { createFixture } from '../helpers.js'
import { createTestTempDirectory } from '../temp.js'

const baseConfig = {
  schema_version: 1,
  installation_mode: 'self_development',
  workspace_root: '.',
  active_config: 'balanced',
  defaults: { coder: 'oai:balanced' },
  configs: { balanced: {}, advanced: {} },
}
const compatible = {
  model_config: { oai: { balanced: 'copilot:gpt-5' } },
}

function fixture(prior = true) {
  const root = createTestTempDirectory('g02-handoff-')
  const receiver = path.join(root, 'receiver')
  fs.mkdirSync(receiver)
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(baseConfig))
  fs.writeFileSync(
    path.join(root, 'config_overrides.json'),
    JSON.stringify(compatible),
  )
  fs.writeFileSync(
    path.join(receiver, 'config.json'),
    JSON.stringify(baseConfig),
  )
  const destination = path.join(receiver, 'config_overrides.json')
  const bytes = Buffer.from(`${JSON.stringify(compatible, null, 2)}\n`)
  if (prior) fs.writeFileSync(destination, bytes)
  return { root, receiver, destination, bytes }
}

test('G02 rejects a newer override incompatible with the older receiver before replacement', () => {
  for (const prior of [true, false]) {
    const f = fixture(prior)
    const older = { ...baseConfig, defaults: { coder: 'oai:ultra' } }
    fs.writeFileSync(
      path.join(f.receiver, 'config.json'),
      JSON.stringify(older),
    )
    if (prior) {
      fs.writeFileSync(
        f.destination,
        JSON.stringify({
          model_config: { oai: { ultra: 'copilot:gpt-5' } },
        }),
      )
    }
    const before = prior ? fs.readFileSync(f.destination) : null
    assert.throws(
      () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
      (error: unknown) => {
        assert.ok(error instanceof PanError)
        assert.match(error.message, /model_config.oai.ultra/u)
        return true
      },
    )
    if (before) {
      assert.deepEqual(fs.readFileSync(f.destination), before)
      assert.equal(loadPipelineConfig(f.receiver).name, 'balanced')
    } else {
      assert.equal(fs.existsSync(f.destination), false)
    }
  }
})

function assertPreserved(f: ReturnType<typeof fixture>, prior: boolean) {
  if (prior) {
    assert.deepEqual(fs.readFileSync(f.destination), f.bytes)
    assert.equal(loadPipelineConfig(f.receiver).name, 'balanced')
  } else {
    assert.equal(fs.existsSync(f.destination), false)
  }
  assert.deepEqual(
    fs.readdirSync(f.receiver).filter((name) => name.endsWith('.tmp')),
    [],
  )
}

test('G02 refuses malformed overrides, aliases, mappings and selection conflicts without leaking values', () => {
  const sentinel = 'SENTINEL_CREDENTIAL_NEVER_REPORT'
  const cases = [
    { bytes: `{"secret":"${sentinel}",`, field: 'configuration' },
    { bytes: '[]', field: 'configuration' },
    {
      bytes: JSON.stringify({
        ...compatible,
        defaults: { coder: `oai:${sentinel}` },
      }),
      field: 'defaults.coder',
    },
    {
      bytes: JSON.stringify({
        model_config: { oai: { balanced: `unknown:${sentinel}` } },
      }),
      field: 'model_config.oai.balanced',
    },
    {
      bytes: JSON.stringify({ ...compatible, active_config: 'advanced' }),
      field: 'active_config',
    },
    {
      bytes: JSON.stringify({
        ...compatible,
        configs: { balanced: { coder: 123 } },
      }),
      field: 'configs.balanced.coder',
    },
  ]
  for (const prior of [true, false]) {
    for (const entry of cases) {
      const f = fixture(prior)
      fs.writeFileSync(path.join(f.root, 'config_overrides.json'), entry.bytes)
      assert.throws(
        () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
        (error: unknown) => {
          assert.ok(error instanceof PanError)
          assert.equal(error.code, 'WORKTREE_OVERRIDE_COPY_FAILED')
          const diagnostic = `${error.message} ${JSON.stringify(error.details)}`
          assert.equal(diagnostic.includes(sentinel), false)
          assert.ok(
            diagnostic.includes(entry.field),
            `${entry.field}: ${JSON.stringify(error.details)}`,
          )
          assert.ok(diagnostic.includes(f.root))
          assert.ok(diagnostic.includes(f.receiver))
          assert.match(
            diagnostic,
            /Correct.*pan worktree create <unused-name> --from <compatible-ref>/u,
          )
          return true
        },
      )
      assertPreserved(f, prior)
    }
  }
})

test('G02 publishes complete compatible aliases and nested settings while preserving effective selection', () => {
  const f = fixture()
  fs.writeFileSync(
    path.join(f.receiver, 'config.json'),
    JSON.stringify({ ...baseConfig, active_config: 'advanced' }),
  )
  const previous = { ...compatible, active_config: 'balanced' }
  fs.writeFileSync(f.destination, JSON.stringify(previous))
  const override = {
    ...previous,
    configs: { balanced: { personas: { reviewer: 'oai:balanced' } } },
    worktrees: { setup: ['echo configured'] },
  }
  const bytes = `${JSON.stringify(override, null, 2)}\n`
  fs.writeFileSync(path.join(f.root, 'config_overrides.json'), bytes)
  handoffSelfDevelopmentLocalConfig(f.root, f.receiver)
  assert.equal(fs.readFileSync(f.destination, 'utf8'), bytes)
  const loaded = loadPipelineConfig(f.receiver)
  assert.equal(loaded.name, 'balanced')
  assert.equal(loaded.config.personas.reviewer, 'copilot:gpt-5')
  assert.equal(loaded.config.personas.coder, 'copilot:gpt-5')
  assert.equal(fs.statSync(f.destination).mode & 0o777, 0o600)
})

test('G02 respects current and legacy filename precedence', () => {
  for (const sourceLegacy of [true, false]) {
    for (const receiverLegacy of [true, false]) {
      const f = fixture()
      if (sourceLegacy) {
        fs.renameSync(
          path.join(f.root, 'config_overrides.json'),
          path.join(f.root, 'config.local.json'),
        )
      } else {
        fs.writeFileSync(path.join(f.root, 'config.local.json'), '[]')
      }
      if (receiverLegacy) {
        fs.renameSync(f.destination, path.join(f.receiver, 'config.local.json'))
        fs.renameSync(
          path.join(f.receiver, 'config.json'),
          path.join(f.receiver, 'project.json'),
        )
      }
      if (sourceLegacy && !receiverLegacy) {
        assert.throws(
          () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
          PanError,
        )
        assertPreserved(f, true)
      } else {
        handoffSelfDevelopmentLocalConfig(f.root, f.receiver)
        assert.equal(loadPipelineConfig(f.receiver).name, 'balanced')
      }
    }
  }
})

test('G02 preserves bytes or absence through read, creation, partial write, pre-rename and rename faults', (t) => {
  for (const prior of [true, false]) {
    for (const phase of [
      'read',
      'create',
      'write',
      'corrupt',
      'pre-rename',
      'rename',
    ]) {
      const f = fixture(prior)
      const open = fs.openSync
      const write = fs.writeFileSync
      const read = fs.readFileSync
      let staged = false
      const fault = () => {
        throw new Error('SENTINEL_IO_ERROR')
      }
      if (phase === 'read') {
        t.mock.method(
          fs,
          'readFileSync',
          (...args: Parameters<typeof read>) => {
            if (args[0] === path.join(f.receiver, 'config.json')) fault()
            return read(...args)
          },
        )
      } else if (phase === 'create') {
        t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
          if (args[1] === 'wx') fault()
          return open(...args)
        })
      } else if (phase === 'write' || phase === 'corrupt') {
        t.mock.method(
          fs,
          'writeFileSync',
          (...args: Parameters<typeof write>) => {
            if (typeof args[0] === 'number') {
              write(args[0], 'partial')
              if (phase === 'write') fault()
              return
            }
            return write(...args)
          },
        )
      } else if (phase === 'pre-rename') {
        t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
          const fd = open(...args)
          if (args[1] === 'wx') staged = true
          return fd
        })
        t.mock.method(fs, 'lstatSync', () => {
          if (staged) fault()
          return fs.statSync(path.join(f.receiver, 'config.json'))
        })
      } else {
        t.mock.method(fs, 'renameSync', fault)
      }
      syncBuiltinESMExports()
      try {
        assert.throws(
          () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
          (error: unknown) => {
            assert.ok(error instanceof PanError)
            assert.equal(error.message.includes('SENTINEL_IO_ERROR'), false)
            return true
          },
        )
      } finally {
        t.mock.restoreAll()
        syncBuiltinESMExports()
      }
      assertPreserved(f, prior)
    }
  }
})

test('G02 refuses concurrent destination deletion or same-byte replacement', (t) => {
  for (const replacement of [false, true]) {
    const f = fixture()
    const open = fs.openSync
    t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
      const fd = open(...args)
      if (args[1] === 'wx') {
        fs.unlinkSync(f.destination)
        if (replacement) fs.writeFileSync(f.destination, f.bytes)
      }
      return fd
    })
    syncBuiltinESMExports()
    try {
      assert.throws(
        () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
        PanError,
      )
    } finally {
      t.mock.restoreAll()
      syncBuiltinESMExports()
    }
    assertPreserved(f, replacement)
  }
})

test('G02 without a source override leaves the receiver untouched', () => {
  const f = fixture()
  fs.unlinkSync(path.join(f.root, 'config_overrides.json'))
  handoffSelfDevelopmentLocalConfig(f.root, f.receiver)
  assertPreserved(f, true)
})

test('G02 refuses concurrent receiver or destination edits and leaves the other writer intact', (t) => {
  for (const prior of [true, false]) {
    for (const changed of [
      'config.json',
      'config_overrides.json',
      'config.local.json',
    ]) {
      const f = fixture(prior)
      const open = fs.openSync
      const changedPath = path.join(f.receiver, changed)
      const otherBytes = Buffer.from(
        JSON.stringify(
          changed === 'config.json'
            ? { ...baseConfig, marker: 'other writer' }
            : { ...compatible, marker: 'other writer' },
        ),
      )
      t.mock.method(fs, 'openSync', (...args: Parameters<typeof open>) => {
        const fd = open(...args)
        if (args[1] === 'wx') fs.writeFileSync(changedPath, otherBytes)
        return fd
      })
      syncBuiltinESMExports()
      try {
        assert.throws(
          () => handoffSelfDevelopmentLocalConfig(f.root, f.receiver),
          PanError,
        )
      } finally {
        t.mock.restoreAll()
        syncBuiltinESMExports()
      }
      assert.deepEqual(fs.readFileSync(changedPath), otherBytes)
      if (changed !== 'config_overrides.json') assertPreserved(f, prior)
      if (prior || changed === 'config_overrides.json') {
        assert.equal(loadPipelineConfig(f.receiver).name, 'balanced')
      }
      assert.equal(
        fs.readdirSync(f.receiver).some((name) => name.endsWith('.tmp')),
        false,
      )
    }
  }
})

test('G02 normal worktree callers hand off only self-development configuration', () => {
  for (const mode of ['self_development', 'embedded', 'detached']) {
    const root = createFixture()
    const configPath = path.join(root, 'config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.installation_mode = mode
    config.workspace_root = mode === 'detached' ? root : '.'
    fs.writeFileSync(configPath, JSON.stringify(config))
    execFileSync('git', ['add', 'config.json'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'fixture installation identity'], {
      cwd: root,
    })
    fs.writeFileSync(
      path.join(root, 'config_overrides.json'),
      JSON.stringify({
        ...JSON.parse(
          fs.readFileSync(path.join(root, 'config_overrides.json'), 'utf8'),
        ),
        marker: 'installation owned',
      }),
    )
    const record = createWorktree(root, `g02-${mode.replace('_', '-')}`)
    const target = path.join(root, record.path, 'config_overrides.json')
    assert.equal(fs.existsSync(target), mode === 'self_development')
    assert.equal(
      JSON.parse(
        fs.readFileSync(path.join(root, 'config_overrides.json'), 'utf8'),
      ).marker,
      'installation owned',
    )
  }
})
