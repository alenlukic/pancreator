import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  applyCustomizations,
  loadCustomizationBundle,
  patchCustomizationText,
  pinCustomizationSettings,
  planCustomizations,
  revertCustomizations,
  type CustomizationBundle,
  type CustomizationOptions,
} from '../../src/lib/vscode-customizations.js'
import { createTestTempDirectory } from '../temp.js'

const bundle = loadCustomizationBundle(
  path.join(process.cwd(), 'library/vscode'),
)
const checksum = (source: string) =>
  createHash('sha256').update(source).digest('base64').replace(/=+$/, '')

function fixture(
  full = false,
  version?: string,
): {
  bundle: CustomizationBundle
  options: CustomizationOptions
  original: Map<string, string>
} {
  const root = createTestTempDirectory('vscode-customizations-')
  const appRoot = path.join(root, 'app')
  const userDataDir = path.join(root, 'User')
  const versioned = version
    ? loadCustomizationBundle(
        path.join(process.cwd(), 'library/vscode'),
        version,
      )
    : bundle
  const selected = full
    ? versioned
    : {
        ...versioned,
        patches: [
          {
            id: 'fixture',
            targets: ['out/fixture.js'],
            find: 'const value = 1',
            replace: 'const value = 2',
            occurrences: 1,
          },
        ],
      }
  const original = new Map<string, string>()
  const sources = new Map<string, string[]>()
  mkdirSync(appRoot)
  mkdirSync(path.join(userDataDir, 'profiles', 'profile'), { recursive: true })

  for (const patch of selected.patches) {
    for (const target of patch.targets) {
      const parts = sources.get(target) ?? []
      parts.push(patch.find)
      sources.set(target, parts)
    }
  }

  const checksums: Record<string, string> = {}

  for (const [target, parts] of sources) {
    const file = path.join(appRoot, target)
    const source = parts.join('\n/* fixture boundary */\n')
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, source)
    original.set(file, source)

    if (target.startsWith('out/')) {
      checksums[target.slice(4)] = checksum(source)
    }
  }

  for (const [file, source] of [
    [
      path.join(appRoot, 'package.json'),
      JSON.stringify({ version: selected.version }),
    ],
    [
      path.join(appRoot, 'product.json'),
      JSON.stringify({
        commit: selected.commit,
        checksums,
        unrelated: 'retained',
      }),
    ],
    [
      path.join(userDataDir, 'settings.json'),
      '{\n// preserve comment\n"theme": "Custom",\n"chat.tools.terminal.idleSilenceTimeoutMs": 200,\n}\n',
    ],
    [
      path.join(userDataDir, 'profiles/profile/settings.json'),
      '{"theme":"Profile"}',
    ],
  ]) {
    writeFileSync(file!, source!)
    original.set(file!, source!)
  }

  return {
    bundle: selected,
    options: { appRoot, userDataDir, stateDir: path.join(root, 'state') },
    original,
  }
}

function noSyntaxCheck(): void {}

function backupDirectory(options: CustomizationOptions): string {
  const appDirectory = path.join(
    options.stateDir,
    readdirSync(options.stateDir)[0]!,
  )
  return path.join(appDirectory, readdirSync(appDirectory)[0]!)
}

test('the 1.139.1 recipe data stays equivalent to its captured baseline', () => {
  const directory = path.join(process.cwd(), 'library/vscode')
  const ui = JSON.parse(
    readFileSync(path.join(directory, 'customizations.json'), 'utf8'),
  ) as { verified_against: unknown; patches: unknown[] }
  const governance = JSON.parse(
    readFileSync(path.join(directory, 'instruction-patches.json'), 'utf8'),
  ) as { patches: unknown[]; settings: unknown[] }
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((item: unknown) => canonical(item))
    } else if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, canonical(record[key])]),
      )
    }

    return value
  }
  const captured = JSON.stringify(
    canonical({
      version: ui.verified_against,
      patches: [...governance.patches, ...ui.patches],
      settings: governance.settings,
    }),
  ).replace(
    /[\u0080-\uffff]/g,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
  assert.equal(
    createHash('sha256').update(captured).digest('hex'),
    '0b07f0d2ae2c2cef74a9292fefeef1cc996aa1c7254292d3bdc89f7a457175f2',
  )
  assert.deepEqual(loadCustomizationBundle(directory, '1.139.1'), bundle)
})

test('1.142.0 inherits common edits, pins its commit, and applies and restores using the shared engine', () => {
  const work = fixture(true, '1.142.0')
  assert.equal(work.bundle.version, '1.142.0')
  assert.equal(work.bundle.commit, '6d62b1d5dace93a33b3a6d3eca1317bd5e15bcb1')
  assert.deepEqual(work.bundle.settings, bundle.settings)

  for (const original of bundle.patches.filter(
    (patch) =>
      patch.id.startsWith('VSP-') ||
      ['VSC-LUNA-EFFORT-2', 'VSC-LUNA-EFFORT-3'].includes(patch.id),
  )) {
    assert.deepEqual(
      work.bundle.patches.find((patch) => patch.id === original.id),
      original,
    )
  }

  assert.equal(
    planCustomizations(work.bundle, work.options).rows.find(
      (row) => row.id === 'VSC-PICKER-HOST-1',
    )?.state,
    'applied',
  )
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
  revertCustomizations(work.bundle, work.options)

  for (const [file, source] of work.original) {
    assert.equal(readFileSync(file, 'utf8'), source)
  }

  writeFileSync(
    path.join(work.options.appRoot, 'product.json'),
    JSON.stringify({ commit: 'unknown', checksums: {} }),
  )
  assert.throws(
    () => planCustomizations(work.bundle, work.options),
    /Unsupported VS Code build/,
  )
  assert.throws(
    () =>
      loadCustomizationBundle(
        path.join(process.cwd(), 'library/vscode'),
        '../../other',
      ),
    /Unsupported VS Code build/,
  )
})

test('the 1.142.0 picker branch lifts provider rows through native callbacks and filters only upgrade rows', () => {
  const selected = loadCustomizationBundle(
    path.join(process.cwd(), 'library/vscode'),
    '1.142.0',
  )

  for (const surface of ['WORKBENCH', 'SESSIONS']) {
    const prefix = `VSC-PICKER-${surface}-`
    const filter = selected.patches.find((patch) => patch.id === `${prefix}1`)!
    const lift = selected.patches.find((patch) => patch.id === `${prefix}2`)!
    const remaining = selected.patches.find(
      (patch) => patch.id === `${prefix}5`,
    )!
    const implementation = runInNewContext(
      `({build(t,i){let r=[];${filter.replace}{if(l)r.push({label:l});for(let h of u)r.push(this._createModelItem(h,i));for(let h of p)r.push({unavailable:this._getUnavailableReason(h,i)})}};a("Pinned",t.pinned);if(${lift.replace}let u;${remaining.replace}}return r}})`,
    ) as {
      build: (
        this: unknown,
        data: unknown,
        context: unknown,
      ) => { label?: string; model?: unknown; unavailable?: string }[]
    }
    const claude = Object.freeze({
      identifier: 'claude',
      metadata: {
        name: 'Claude',
        byokModelIdentifier: 'anthropic/claude',
        modelGroup: { id: 'anthropic' },
      },
    })
    const gpt = Object.freeze({
      identifier: 'gpt',
      metadata: { name: 'GPT', isBYOK: true, vendor: 'openai' },
    })
    const hosted = Object.freeze({
      identifier: 'hosted',
      metadata: { name: 'Hosted', vendor: 'copilotcli' },
    })
    const context = {
      _languageModelsService: {
        lookupLanguageModel: () => undefined,
        getVendors: () => [
          { vendor: 'anthropic', displayName: 'Anthropic' },
          { vendor: 'openai', displayName: 'OpenAI' },
        ],
      },
      _getUnavailableReason: (entry: {
        reason: string
        needsUpdate?: boolean
      }) => (entry.needsUpdate ? 'update' : entry.reason),
      _createModelItem: (model: unknown) => ({ model }),
    }
    const data = Object.freeze({
      pinned: [],
      suggested: [],
      other: Object.freeze([gpt, hosted, claude]),
      unavailable: [
        { reason: 'upgrade' },
        { reason: 'upgrade', needsUpdate: true },
      ],
    })
    const rows = implementation.build.call(context, data, {})
    assert.deepEqual(
      Array.from(rows.filter((row) => row.label).map((row) => row.label)),
      ['Anthropic', 'OpenAI'],
    )
    assert.equal(
      rows.some((row) => row.unavailable === 'upgrade'),
      false,
    )
    assert.equal(
      rows.some((row) => row.unavailable === 'update'),
      true,
    )
    const models = rows.filter((row) => row.model).map((row) => row.model)
    assert.equal(models[0], claude)
    assert.equal(models[1], gpt)
    assert.equal(models[2], hosted)
    assert.equal(data.other.length, 3)
  }
})

test('the 1.142.0 native model switch synchronizes registration before selecting a provider model', async () => {
  const selected = loadCustomizationBundle(
    path.join(process.cwd(), 'library/vscode'),
    '1.142.0',
  )
  const patch = selected.patches.find(
    (entry) => entry.id === 'VSC-PICKER-HOST-1',
  )!
  assert.equal(patch.find, patch.replace)
  const native = runInNewContext(`({${patch.find}})`) as {
    setModel: (this: unknown, id: string, effort: string) => Promise<void>
  }
  const calls: string[] = []
  const session = {
    sessionId: 'fixture',
    syncByokModels: async () => {
      calls.push('registration')
    },
    _logService: { info: () => {} },
    _wrapper: {
      session: {
        setModel: async (id: string, options: { reasoningEffort: string }) => {
          calls.push('selection')
          assert.equal(id, 'openai/OpenAI/gpt-6-luna')
          assert.equal(options.reasoningEffort, 'high')
        },
      },
    },
    _awaitControlPlaneRpc: async (_name: string, promise: Promise<void>) =>
      promise,
  }
  await native.setModel.call(session, 'openai/OpenAI/gpt-6-luna', 'high')
  assert.deepEqual(calls, ['registration', 'selection'])
})

test('version overrides reject unknown, duplicate, mismatched, and escaping recipes', () => {
  const source = path.join(process.cwd(), 'library/vscode')

  for (const failure of [
    'unknown-id',
    'duplicate-id',
    'wrong-base',
    'escaping-path',
  ]) {
    const directory = createTestTempDirectory('vscode-version-recipe-')

    for (const file of [
      'customizations.json',
      'instruction-patches.json',
      'customizations-1.142.0.json',
    ]) {
      writeFileSync(
        path.join(directory, file),
        readFileSync(path.join(source, file)),
      )
    }

    const file = path.join(
      directory,
      failure === 'escaping-path'
        ? 'customizations.json'
        : 'customizations-1.142.0.json',
    )
    const document = JSON.parse(readFileSync(file, 'utf8')) as Record<
      string,
      unknown
    >

    if (failure === 'escaping-path') {
      document.versions = { '1.142.0': '../outside.json' }
    } else if (failure === 'wrong-base') {
      document.base_version = 'other'
    } else {
      const overrides = document.patch_overrides as Record<string, unknown>[]

      if (failure === 'unknown-id') {
        overrides[0]!.id = 'unknown'
      } else {
        overrides.push(overrides[0]!)
      }
    }

    writeFileSync(file, JSON.stringify(document))
    assert.throws(() => loadCustomizationBundle(directory, '1.142.0'))
  }
})

test('captured UI and canonical governance edits all preflight, apply idempotently, and restore both profiles byte for byte', () => {
  const work = fixture(true)
  const plan = planCustomizations(work.bundle, work.options)
  assert.equal(plan.state, 'pending')
  assert.ok(plan.rows.every((row) => row.state === 'pending'))
  assert.ok(plan.rows.some((row) => row.id.startsWith('VSP-')))
  assert.ok(plan.rows.some((row) => row.id.startsWith('VSC-PICKER-')))
  assert.ok(plan.rows.some((row) => row.id === 'VSC-DEFAULT-MODEL'))
  assert.ok(plan.rows.some((row) => row.id.startsWith('VSC-LUNA-EFFORT-')))

  for (const [file, source] of work.original) {
    assert.equal(readFileSync(file, 'utf8'), source)
  }

  assert.equal(existsSync(work.options.stateDir), false)
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
  const backup = backupDirectory(work.options)
  assert.equal(statSync(path.join(backup, 'backup.json')).mode & 0o777, 0o600)
  const settings = readFileSync(
    path.join(work.options.userDataDir!, 'settings.json'),
    'utf8',
  )
  assert.ok(settings.includes('// preserve comment'))
  assert.ok(settings.includes('"theme": "Custom"'))
  assert.ok(settings.includes('"chat.tools.terminal.idleSilenceTimeoutMs": 0'))
  const product = JSON.parse(
    readFileSync(path.join(work.options.appRoot, 'product.json'), 'utf8'),
  ) as { checksums: Record<string, string>; unrelated: string }
  assert.equal(product.unrelated, 'retained')

  for (const [key, value] of Object.entries(product.checksums)) {
    assert.equal(
      checksum(
        readFileSync(path.join(work.options.appRoot, 'out', key), 'utf8'),
      ),
      value,
    )
  }

  revertCustomizations(work.bundle, work.options)

  for (const [file, source] of work.original) {
    assert.equal(readFileSync(file, 'utf8'), source)
  }

  assert.equal(planCustomizations(work.bundle, work.options).state, 'pending')
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
})

test('version and commit drift, missing or ambiguous anchors, and checksum mismatch refuse before app or settings writes', () => {
  for (const failure of [
    'version',
    'commit',
    'missing',
    'ambiguous',
    'checksum',
  ]) {
    const work = fixture()
    const file = path.join(
      work.options.appRoot,
      failure === 'version'
        ? 'package.json'
        : failure === 'commit' || failure === 'checksum'
          ? 'product.json'
          : 'out/fixture.js',
    )
    const source =
      failure === 'version'
        ? '{"version":"future"}'
        : failure === 'missing'
          ? 'const other = 1'
          : failure === 'ambiguous'
            ? 'const value = 1; const value = 1'
            : JSON.stringify({
                commit: failure === 'commit' ? 'future' : bundle.commit,
                checksums: { 'fixture.js': 'wrong' },
              })
    writeFileSync(file, source)

    if (failure === 'missing' || failure === 'ambiguous') {
      writeFileSync(
        path.join(work.options.appRoot, 'product.json'),
        JSON.stringify({
          commit: bundle.commit,
          checksums: { 'fixture.js': checksum(source) },
        }),
      )
    }

    const expected =
      failure === 'missing' || failure === 'ambiguous'
        ? /anchor/
        : failure === 'checksum'
          ? /checksum/
          : /Unsupported/
    assert.throws(
      () => applyCustomizations(work.bundle, work.options, noSyntaxCheck),
      expected,
    )
    assert.equal(readFileSync(file, 'utf8'), source)
    assert.equal(
      readFileSync(
        path.join(work.options.userDataDir!, 'settings.json'),
        'utf8',
      ),
      work.original.get(path.join(work.options.userDataDir!, 'settings.json')),
    )
    assert.equal(
      existsSync(path.join(backupDirectory(work.options), 'backup.json')),
      false,
    )
  }
})

test('live customization tickets exclude another operation and dead tickets recover without overwriting a new lock', () => {
  const work = fixture()
  assert.throws(() =>
    applyCustomizations(work.bundle, work.options, () => {
      throw new Error('prepare')
    }),
  )
  const locks = path.join(backupDirectory(work.options), 'locks')
  const ticket = path.join(locks, 'fixture-owner')
  mkdirSync(ticket)
  writeFileSync(
    path.join(ticket, 'owner.json'),
    JSON.stringify({ pid: process.pid }),
  )
  assert.throws(
    () => applyCustomizations(work.bundle, work.options, noSyntaxCheck),
    /Another customization/,
  )
  writeFileSync(
    path.join(ticket, 'owner.json'),
    JSON.stringify({ pid: 2147483647 }),
  )
  assert.equal(
    applyCustomizations(work.bundle, work.options, noSyntaxCheck).state,
    'applied',
  )
  assert.equal(existsSync(ticket), false)
  assert.equal(readdirSync(locks).length, 0)
})

test('syntax failure precedes every write and backup publication', () => {
  const work = fixture()
  assert.throws(
    () =>
      applyCustomizations(work.bundle, work.options, () => {
        throw new Error('invalid syntax')
      }),
    /invalid syntax/,
  )

  for (const [file, source] of work.original) {
    assert.equal(readFileSync(file, 'utf8'), source)
  }

  assert.equal(
    existsSync(path.join(backupDirectory(work.options), 'backup.json')),
    false,
  )
})

test('restore protects later app and settings edits and detects corrupt backups before restoring anything', () => {
  for (const failure of ['app', 'settings', 'backup']) {
    const work = fixture()
    applyCustomizations(work.bundle, work.options, noSyntaxCheck)
    const file =
      failure === 'backup'
        ? path.join(backupDirectory(work.options), '0.before')
        : failure === 'app'
          ? path.join(work.options.appRoot, 'out/fixture.js')
          : path.join(work.options.userDataDir!, 'settings.json')
    writeFileSync(file, 'operator changed this')
    assert.throws(
      () => revertCustomizations(work.bundle, work.options),
      /refusing to overwrite|Backup integrity/,
    )
    assert.equal(readFileSync(file, 'utf8'), 'operator changed this')
    assert.equal(
      readFileSync(path.join(work.options.appRoot, 'out/fixture.js'), 'utf8'),
      failure === 'app' ? 'operator changed this' : 'const value = 2',
    )
  }
})

test('settings pinning preserves JSONC strings and nested values, rejects duplicate keys, and never reveals invalid input', () => {
  const settings = new Map([['pin', false]])
  const source =
    '{/*keep*/"nested":{"pin":true},"url":"https://example.test/,}","pin": {"old":[1,2,]},}'
  const result = pinCustomizationSettings(source, settings)
  assert.equal(
    result,
    '{/*keep*/"nested":{"pin":true},"url":"https://example.test/,}","pin": false,}',
  )
  assert.equal(pinCustomizationSettings(result, settings), result)
  assert.throws(
    () => pinCustomizationSettings('{"pin":true,"pin":false}', settings),
    /Duplicate/,
  )
  assert.throws(
    () => pinCustomizationSettings('{"secret":"DO-NOT-PRINT"', settings),
    (error: unknown) =>
      error instanceof Error && !error.message.includes('DO-NOT-PRINT'),
  )
  assert.throws(
    () => pinCustomizationSettings('{/*unterminated', settings),
    /Unterminated/,
  )
})

test('path escapes and symlink targets are refused and settings can be skipped', () => {
  const work = fixture()
  const outside = path.join(work.options.appRoot, '../outside.js')
  writeFileSync(outside, 'const value = 1')
  const escaping = {
    ...work.bundle,
    patches: [{ ...work.bundle.patches[0]!, targets: ['../outside.js'] }],
  }
  assert.throws(() => planCustomizations(escaping, work.options), /escapes/)
  symlinkSync(outside, path.join(work.options.appRoot, 'out/link.js'))
  const linked = {
    ...work.bundle,
    patches: [{ ...work.bundle.patches[0]!, targets: ['out/link.js'] }],
  }
  assert.throws(
    () => planCustomizations(linked, work.options),
    /symlink|outside/,
  )
  assert.equal(
    applyCustomizations(
      work.bundle,
      { ...work.options, userDataDir: undefined },
      noSyntaxCheck,
    ).state,
    'applied',
  )
  assert.equal(
    readFileSync(path.join(work.options.userDataDir!, 'settings.json'), 'utf8'),
    work.original.get(path.join(work.options.userDataDir!, 'settings.json')),
  )
})

test('short model IDs are unambiguous and preserve exact ID and family precedence in both versions', () => {
  for (const version of ['1.139.1', '1.142.0']) {
    const selected = loadCustomizationBundle(
      path.join(process.cwd(), 'library/vscode'),
      version,
    )
    const patch = selected.patches.find(
      (entry) => entry.id === 'VSC-DEFAULT-MODEL',
    )!
    const compare = (left: string, right: string) => left.localeCompare(right)
    const resolve = runInNewContext(`(${patch.replace})`, {
      dcn: 'auto',
      NLn: 'auto',
      Dyr: compare,
      H8r: compare,
    }) as (value: string, models: unknown[]) => unknown
    const luna = { metadata: { id: 'openai/OpenAI/gpt-6-luna' } }
    const other = { metadata: { id: 'other/gpt-6-luna' } }
    const exact = { metadata: { id: 'gpt-6-luna' } }
    const family = {
      metadata: { id: 'member', family: 'gpt-6-luna', version: '1' },
    }
    assert.equal(resolve(' GPT-6-LUNA ', [luna]), luna)
    assert.equal(resolve('gpt-6-luna', [luna, other]), undefined)
    assert.equal(resolve('gpt-6-luna', [luna, exact]), exact)
    assert.equal(resolve('gpt-6-luna', [luna, family]), family)
    assert.equal(resolve('missing', [luna]), undefined)
  }
})

test('provider sections preserve native model objects, selection callbacks, pinned rows, and update rows', () => {
  for (const target of ['SESSIONS', 'WORKBENCH']) {
    const patch = bundle.patches.find(
      (entry) => entry.id === `VSC-PICKER-${target}-8`,
    )!
    const helper = patch.replace.slice(0, -patch.find.length)
    const callbacks = {
      Hre: (_service: unknown, vendor: string) => vendor,
      mse: (_service: unknown, vendor: string) => vendor,
      E3: (
        model: { identifier: string },
        _selected: string,
        select: (value: unknown) => void,
      ) => ({ action: () => select(model) }),
      d8: (
        model: { identifier: string },
        _selected: string,
        select: (value: unknown) => void,
      ) => ({ action: () => select(model) }),
      GJ: (action: unknown, model: unknown) => ({ action, model }),
      VZ: (action: unknown, model: unknown) => ({ action, model }),
      Mkt: (id: string, _control: unknown, reason: string) => ({ id, reason }),
      bCt: (id: string, _control: unknown, reason: string) => ({ id, reason }),
      qJ: () => false,
      BZ: () => false,
    }
    const functions = runInNewContext(
      `${helper};({lift:__mpLift,top:__mpTop})`,
      callbacks,
    ) as {
      lift: (
        value: unknown,
        append: (label: string, models: unknown[]) => void,
        service: unknown,
      ) => unknown[]
      top: (value: unknown) => void
    }
    const model = (id: string, vendor: string) => ({
      identifier: id,
      metadata: {
        id,
        name: id,
        byokModelIdentifier: id,
        modelGroup: { id: vendor },
      },
    })
    const anthropic = model('claude', 'anthropic')
    const openai = model('gpt', 'openai')
    const update = model('update', 'openai')
    const pinned = model('pinned', 'anthropic')
    const other = {
      identifier: 'hosted',
      metadata: { name: 'hosted', vendor: 'copilotcli' },
    }
    const service = { lookupLanguageModel: () => undefined }
    const sections: string[] = []
    const groups: unknown[] = []
    const remaining = functions.lift(
      { other: [openai, other, anthropic] },
      (label, models) => {
        sections.push(label)
        groups.push(...models)
      },
      service,
    )
    assert.deepEqual(sections, ['anthropic', 'openai'])
    assert.equal(groups[0], anthropic)
    assert.equal(groups[1], openai)
    assert.equal(remaining[0], other)
    const items: {
      model?: unknown
      action?: () => void
      label?: string
      reason?: string
    }[] = []
    const selected: unknown[] = []
    functions.top({
      options: {
        models: [pinned, update, openai, anthropic, other],
        languageModelsService: service,
        controlModels: { update: { minVSCodeVersion: 'future' } },
        actions: {
          onSelect: (value: unknown) => {
            selected.push(value)
          },
        },
        presentation: {},
      },
      items,
      placed: new Set(['pinned']),
      markPlaced: () => {},
      makePinAction: () => {},
    })
    assert.deepEqual(
      items.filter((item) => item.label).map((item) => item.label),
      ['anthropic', 'openai'],
    )
    assert.equal(items.find((item) => item.reason)?.reason, 'update')

    for (const item of items) {
      item.action?.()
    }

    assert.equal(selected[0], anthropic)
    assert.equal(selected[1], openai)
    assert.equal(
      items.some((item) => item.model === pinned || item.model === other),
      false,
    )
  }
})

test('stale BYOK registration retries exactly once only for a registered model in an idle session', async () => {
  const patch = bundle.patches.find(
    (entry) => entry.id === 'VSC-PICKER-HOST-1',
  )!
  const select = runInNewContext(
    `(async function(e,i,t,a,l,p){let s={configurationId:'config'},u=this.session;${patch.replace}})`,
    { n0: () => 'configuration', i0: () => 'options' },
  ) as (this: unknown, ...args: unknown[]) => Promise<void>

  for (const scenario of [
    'recover',
    'active',
    'unknown',
    'other-error',
    'retry-error',
  ]) {
    let destroyed = 0
    let resumed = 0
    let retried = 0
    const failure =
      scenario === 'other-error'
        ? new Error('different failure')
        : new Error("Provider model 'luna' is not registered")
    const host = {
      session: {
        sessionId: 'fixture',
        hasActiveTurn: scenario === 'active',
        setModel: async () => {
          throw failure
        },
      },
      _byokModels: scenario === 'unknown' ? [] : [{ id: 'luna' }],
      _logService: { info: () => {} },
      _configurationService: {},
      _destroyLiveSession: async () => {
        destroyed++
      },
      _resolveChatContext: () => ({}),
      _ensureResolvedChatSession: async () => {
        resumed++
        return {
          setModel: async (id: string) => {
            assert.equal(id, 'luna')
            retried++

            if (scenario === 'retry-error') {
              throw new Error('retry failed')
            }
          },
        }
      },
    }
    const result = select.call(
      host,
      'context',
      'configuration',
      { id: 'luna' },
      {},
      {},
      {},
    )

    if (scenario === 'recover') {
      await result
    } else {
      await assert.rejects(result)
    }

    const expected =
      scenario === 'recover' || scenario === 'retry-error' ? 1 : 0
    assert.deepEqual(
      [destroyed, resumed, retried],
      [expected, expected, expected],
    )
  }
})

test('captured Luna effort default preserves other models, unsupported high values, and read-only values', () => {
  const patch = bundle.patches.find(
    (entry) => entry.id === 'VSC-LUNA-EFFORT-3',
  )!
  const convert = runInNewContext(
    `(o,i,n)=>{let t={},r,s={_reasoningEffortKeys:new Set(['thinkingLevel','reasoningEffort'])};${patch.replace}};return t[i]}`,
    {},
  ) as (
    model: string,
    key: string,
    schema: Record<string, unknown>,
  ) => { default: string }
  const schema = {
    type: 'string',
    default: 'medium',
    enum: ['low', 'medium', 'high'],
  }
  assert.equal(
    convert('openai/OpenAI/gpt-6-luna', 'thinkingLevel', schema).default,
    'high',
  )
  assert.equal(
    convert('openai/OpenAI/gpt-6-luna', 'reasoningEffort', schema).default,
    'high',
  )
  assert.equal(
    convert('openai/OpenAI/gpt-6.1-sol', 'thinkingLevel', schema).default,
    'medium',
  )
  assert.equal(
    convert('other/gpt-6-luna', 'thinkingLevel', schema).default,
    'medium',
  )
  assert.equal(
    convert('openai/OpenAI/gpt-6-luna', 'contextTier', schema).default,
    'medium',
  )
  assert.equal(
    convert('openai/OpenAI/gpt-6-luna', 'thinkingLevel', {
      ...schema,
      readOnly: true,
    }).default,
    'medium',
  )
  assert.equal(
    convert('openai/OpenAI/gpt-6-luna', 'thinkingLevel', {
      ...schema,
      enum: ['medium'],
    }).default,
    'medium',
  )
  assert.equal(schema.default, 'medium')
})

test('a shortened replacement inside an original instruction stays pending until the full original is removed', () => {
  const patch = {
    id: 'shortened',
    targets: [],
    find: 'Completion notification. Do NOT poll.',
    replace: 'Completion notification.',
    occurrences: 1,
  }
  assert.deepEqual(patchCustomizationText(patch.find, patch), {
    source: patch.replace,
    state: 'pending',
  })
  assert.deepEqual(patchCustomizationText(patch.replace, patch), {
    source: patch.replace,
    state: 'applied',
  })
  assert.throws(
    () => patchCustomizationText(`${patch.replace} ${patch.replace}`, patch),
    /ambiguous/,
  )
})

test('an inserted helper that contains its original anchor is recognized as applied', () => {
  const patch = {
    id: 'helper',
    targets: [],
    find: 'function label(){',
    replace: 'function helper(){}function label(){',
    occurrences: 1,
  }
  const once = patchCustomizationText('function label(){}', patch)
  assert.equal(once.state, 'pending')
  assert.deepEqual(patchCustomizationText(once.source, patch), {
    source: once.source,
    state: 'applied',
  })
  assert.throws(
    () => patchCustomizationText('function label(){}function label(){}', patch),
    /ambiguous/,
  )
})
