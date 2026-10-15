import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

interface Patch {
  id: string
  targets: string[]
  find: string
  replace: string
  occurrences: number
}

export interface CustomizationBundle {
  version: string
  commit: string
  patches: Patch[]
  settings: Map<string, string | number | boolean>
}

export interface CustomizationOptions {
  appRoot: string
  userDataDir: string | undefined
  stateDir: string
}

interface Change {
  file: string
  before: Buffer
  after: Buffer
}

interface BackupFile {
  file: string
  before: string
  after: string
  backup: string
}

interface Backup {
  app: string
  version: string
  commit: string
  files: BackupFile[]
}

export interface CustomizationPlan {
  state: 'pending' | 'applied'
  rows: { id: string; target: string; state: 'pending' | 'applied' }[]
  changes: Change[]
  version: string
  commit: string
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected a JSON object')
  }

  return value as Record<string, unknown>
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value) {
    throw new Error('Expected a nonempty string')
  }

  return value
}

function json(file: string): Record<string, unknown> {
  return object(JSON.parse(readFileSync(file, 'utf8')) as unknown)
}

function inside(root: string, relative: string): string {
  const file = path.resolve(root, relative)
  const segment = path.relative(root, file)

  if (!segment || segment.startsWith('..') || path.isAbsolute(segment)) {
    throw new Error(`Path escapes its root: ${relative}`)
  }

  if (existsSync(file)) {
    const actual = path.relative(realpathSync(root), realpathSync(file))

    if (
      actual.startsWith('..') ||
      path.isAbsolute(actual) ||
      lstatSync(file).isSymbolicLink()
    ) {
      throw new Error(
        `Refusing a symlink or path outside its root: ${relative}`,
      )
    }
  }

  return file
}

/** Load the common recipes and the verified overrides for a selected VS Code version. */
export function loadCustomizationBundle(
  directory: string,
  version?: string,
): CustomizationBundle {
  const ui = json(path.join(directory, 'customizations.json'))
  const governance = json(path.join(directory, 'instruction-patches.json'))
  const verified = object(ui.verified_against)
  const governanceVerified = object(governance.verified_against)

  if (
    verified.vscode !== governanceVerified.vscode ||
    verified.commit !== governanceVerified.commit
  ) {
    throw new Error(
      'UI and governance manifests were verified against different VS Code builds',
    )
  }

  const patches: Patch[] = []
  const ids = new Set<string>()

  for (const manifest of [governance, ui]) {
    if (manifest.schema_version !== 1 || !Array.isArray(manifest.patches)) {
      throw new Error('Unsupported customization manifest')
    }

    for (const item of manifest.patches) {
      const entry = object(item)
      const id = text(entry.id)

      if (
        ids.has(id) ||
        !Array.isArray(entry.targets) ||
        !entry.targets.length ||
        entry.occurrences !== 1
      ) {
        throw new Error(`Invalid or duplicate patch: ${id}`)
      }

      ids.add(id)
      patches.push({
        id,
        targets: entry.targets.map((target: unknown) => text(target)),
        find: text(entry.find),
        replace: text(entry.replace),
        occurrences: 1,
      })
    }
  }

  const settings = new Map<string, string | number | boolean>()

  if (!Array.isArray(governance.settings)) {
    throw new Error('Missing governance settings')
  }

  for (const item of governance.settings) {
    const entry = object(item)
    const value = entry.value

    if (
      typeof value !== 'string' &&
      typeof value !== 'number' &&
      typeof value !== 'boolean'
    ) {
      throw new Error('Unsupported governance setting value')
    }

    settings.set(text(entry.key), value)
  }

  const bundle = {
    version: text(verified.vscode),
    commit: text(verified.commit),
    patches,
    settings,
  }

  if (version === undefined || version === bundle.version) {
    return bundle
  }

  const versions = object(ui.versions ?? {})

  if (!Object.hasOwn(versions, version)) {
    throw new Error(`Unsupported VS Code build ${version}; no verified recipe`)
  }

  const variant = json(inside(directory, text(versions[version])))
  const target = object(variant.verified_against)

  if (
    variant.schema_version !== 1 ||
    variant.base_version !== bundle.version ||
    target.vscode !== version ||
    !Array.isArray(variant.omit) ||
    !Array.isArray(variant.patch_overrides)
  ) {
    throw new Error('Invalid version-specific customization manifest')
  }

  const omitted = new Set(variant.omit.map((id: unknown) => text(id)))

  if (
    omitted.size !== variant.omit.length ||
    [...omitted].some((id) => !ids.has(id))
  ) {
    throw new Error(
      'Version-specific manifest omits an unknown or duplicate patch',
    )
  }

  const overrides = new Map<string, { find: string; replace: string }>()

  for (const item of variant.patch_overrides) {
    const entry = object(item)
    const id = text(entry.id)

    if (!ids.has(id) || omitted.has(id) || overrides.has(id)) {
      throw new Error(`Invalid or duplicate version-specific patch: ${id}`)
    }

    overrides.set(id, { find: text(entry.find), replace: text(entry.replace) })
  }

  return {
    version,
    commit: text(target.commit),
    patches: patches
      .filter((patch) => !omitted.has(patch.id))
      .map((patch) => ({ ...patch, ...overrides.get(patch.id) })),
    settings,
  }
}

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function checksum(data: Buffer): string {
  return createHash('sha256').update(data).digest('base64').replace(/=+$/, '')
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1
}

/** Preflight every anchor; already applied edits remain idempotent even when they contain their original anchor. */
export function patchCustomizationText(
  source: string,
  patch: Patch,
): { source: string; state: 'pending' | 'applied' } {
  const originals = count(source, patch.find)
  const replacements = count(source, patch.replace)

  if (
    originals === patch.occurrences &&
    (!patch.replace.includes(patch.find) || replacements === 0)
  ) {
    return {
      source: source.replace(patch.find, patch.replace),
      state: 'pending',
    }
  }

  const remaining = source.split(patch.replace).join('')

  if (
    replacements === patch.occurrences &&
    count(remaining, patch.find) === 0
  ) {
    return { source, state: 'applied' }
  }

  throw new Error(
    `${patch.id}: missing or ambiguous anchor; re-audit this VS Code build`,
  )
}

interface Token {
  start: number
  end: number
  value: string
}

function jsoncTokens(source: string): Token[] {
  const tokens: Token[] = []
  let position = 0

  while (position < source.length) {
    const start = position
    const character = source[position]!

    if (/\s/.test(character)) {
      position++
    } else if (source.startsWith('//', position)) {
      const end = source.indexOf('\n', position)
      position = end === -1 ? source.length : end
    } else if (source.startsWith('/*', position)) {
      const end = source.indexOf('*/', position + 2)

      if (end === -1) {
        throw new Error('Unterminated settings comment')
      }

      position = end + 2
    } else {
      if (character === '"') {
        position++

        while (position < source.length) {
          const next = source[position++]

          if (next === '\\') {
            position++
          } else if (next === '"') {
            break
          }
        }
      } else if ('{}[],:'.includes(character)) {
        position++
      } else {
        while (
          position < source.length &&
          !/[\s{}\[\],:]/.test(source[position]!) &&
          !source.startsWith('//', position) &&
          !source.startsWith('/*', position)
        ) {
          position++
        }
      }

      tokens.push({
        start,
        end: position,
        value: source.slice(start, position),
      })
    }
  }

  return tokens
}

/** Pin governance keys in JSONC without rewriting comments or unrelated settings. */
export function pinCustomizationSettings(
  source: string,
  settings: CustomizationBundle['settings'],
): string {
  const tokens = jsoncTokens(source)
  const cleaned = tokens
    .filter(
      (token, index) =>
        token.value !== ',' ||
        !['}', ']'].includes(tokens[index + 1]?.value ?? ''),
    )
    .map((token) => token.value)
    .join(' ')
  try {
    object(JSON.parse(cleaned) as unknown)
  } catch {
    throw new Error(
      'Invalid settings JSONC; repair it before applying customizations',
    )
  }

  const edits: { start: number; end: number; value: string }[] = []
  const present = new Set<string>()
  let depth = 0

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!

    if (token.value === '{' || token.value === '[') {
      depth++
    } else if (token.value === '}' || token.value === ']') {
      depth--
    } else if (
      depth === 1 &&
      token.value.startsWith('"') &&
      tokens[index + 1]?.value === ':'
    ) {
      const key = JSON.parse(token.value) as unknown

      if (typeof key !== 'string') {
        throw new Error('Invalid settings key')
      }

      if (present.has(key)) {
        throw new Error(`Duplicate settings key: ${key}`)
      }

      present.add(key)

      if (settings.has(key)) {
        let end = index + 2
        let nested = 0

        do {
          const value = tokens[end]!.value

          if (value === '{' || value === '[') {
            nested++
          } else if (value === '}' || value === ']') {
            nested--
          }

          end++
        } while (nested > 0)

        edits.push({
          start: tokens[index + 2]!.start,
          end: tokens[end - 1]!.end,
          value: JSON.stringify(settings.get(key)),
        })
      }
    }
  }

  const missing = [...settings].filter(([key]) => !present.has(key))

  if (missing.length) {
    const closing = tokens.at(-1)!
    const previous = tokens.at(-2)!
    const separator =
      previous.value === '{' || previous.value === ',' ? '' : ','
    edits.push({
      start: closing.start,
      end: closing.start,
      value: `${separator}\n${missing.map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`).join(',\n')}\n`,
    })
  }

  let updated = source

  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    updated =
      updated.slice(0, edit.start) + edit.value + updated.slice(edit.end)
  }

  return updated
}

function settingsFiles(options: CustomizationOptions): string[] {
  if (!options.userDataDir) {
    return []
  }

  const files = [inside(options.userDataDir, 'settings.json')]
  const profiles = inside(options.userDataDir, 'profiles')

  if (existsSync(profiles)) {
    for (const entry of readdirSync(profiles, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const file = inside(
          options.userDataDir,
          `profiles/${entry.name}/settings.json`,
        )

        if (existsSync(file)) {
          files.push(file)
        }
      }
    }
  }

  return files
}

/** Inspect the selected app and existing profiles without changing either. */
export function planCustomizations(
  bundle: CustomizationBundle,
  options: CustomizationOptions,
): CustomizationPlan {
  const app = realpathSync(options.appRoot)
  const version = text(json(path.join(app, 'package.json')).version)
  const productFile = inside(app, 'product.json')
  const product = json(productFile)
  const commit = text(product.commit)

  if (version !== bundle.version || commit !== bundle.commit) {
    throw new Error(
      `Unsupported VS Code build ${version} (${commit}); re-audit before applying`,
    )
  }

  const checksums = object(product.checksums)
  const rows: CustomizationPlan['rows'] = []
  const changes: Change[] = []
  const sources = new Map<string, Buffer>()
  const patched = new Map<string, string>()

  for (const patch of bundle.patches) {
    for (const target of patch.targets) {
      const file = inside(app, target)

      if (!sources.has(file)) {
        const original = readFileSync(file)
        const key = target.startsWith('out/') ? target.slice(4) : undefined

        if (key && key in checksums && checksums[key] !== checksum(original)) {
          throw new Error(
            `${target}: integrity checksum does not match; repair the app first`,
          )
        }

        sources.set(file, original)
        patched.set(file, original.toString('utf8'))
      }

      const result = patchCustomizationText(patched.get(file)!, patch)
      patched.set(file, result.source)
      rows.push({ id: patch.id, target, state: result.state })
    }
  }

  for (const [file, source] of patched) {
    const before = sources.get(file)!
    const after = Buffer.from(source)
    const target = path.relative(app, file).split(path.sep).join('/')
    const key = target.startsWith('out/') ? target.slice(4) : undefined

    if (!before.equals(after)) {
      changes.push({ file, before, after })
    }

    if (key && key in checksums) {
      checksums[key] = checksum(after)
    }
  }

  if (changes.length) {
    changes.push({
      file: productFile,
      before: readFileSync(productFile),
      after: Buffer.from(`${JSON.stringify(product, null, 2)}\n`),
    })
  }

  for (const file of settingsFiles(options)) {
    const before = readFileSync(file)
    const after = Buffer.from(
      pinCustomizationSettings(before.toString('utf8'), bundle.settings),
    )

    if (!before.equals(after)) {
      changes.push({ file, before, after })
    }
  }

  return {
    state: changes.length ? 'pending' : 'applied',
    rows,
    changes,
    version,
    commit,
  }
}

function atomicWrite(file: string, data: Buffer, mode: number): void {
  const temporary = `${file}.pan-customizations-${randomUUID()}`

  try {
    writeFileSync(temporary, data, { flag: 'wx', mode })
    chmodSync(temporary, mode)
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function syntaxCheck(file: string, data: Buffer, scratch: string): void {
  if (!file.endsWith('.js')) {
    return
  }

  const temporary = path.join(scratch, `${randomUUID()}.js`)

  try {
    writeFileSync(temporary, data, { mode: 0o600 })
    const result = spawnSync(process.execPath, ['--check', temporary], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    })

    if (result.status !== 0) {
      throw new Error(`${path.basename(file)}: JavaScript syntax check failed`)
    }
  } finally {
    rmSync(temporary, { force: true })
  }
}

function statePath(options: CustomizationOptions): string {
  const app = realpathSync(options.appRoot)
  const identity = `${text(json(path.join(app, 'package.json')).version)}:${text(json(path.join(app, 'product.json')).commit)}`
  return path.join(
    options.stateDir,
    digest(Buffer.from(app)).slice(0, 16),
    digest(Buffer.from(identity)).slice(0, 16),
  )
}

function transaction(changes: Change[]): void {
  for (const change of changes) {
    if (!readFileSync(change.file).equals(change.before)) {
      throw new Error(`File changed during preparation: ${change.file}`)
    }
  }

  const written: Change[] = []

  try {
    for (const change of changes) {
      if (!readFileSync(change.file).equals(change.before)) {
        throw new Error(`File changed during apply: ${change.file}`)
      }

      atomicWrite(change.file, change.after, statSync(change.file).mode & 0o777)
      written.push(change)
    }
  } catch (error) {
    for (const change of written.reverse()) {
      atomicWrite(
        change.file,
        change.before,
        statSync(change.file).mode & 0o777,
      )
    }

    throw error
  }
}

function locked<T>(
  options: CustomizationOptions,
  operation: (directory: string) => T,
): T {
  const directory = statePath(options)
  const locks = path.join(directory, 'locks')
  mkdirSync(locks, { recursive: true, mode: 0o700 })
  // Unique tickets prevent two recoverers from deleting a newly acquired lock.
  const ticket = path.join(locks, randomUUID())
  mkdirSync(ticket, { mode: 0o700 })

  try {
    writeFileSync(
      path.join(ticket, 'owner.json'),
      JSON.stringify({ pid: process.pid }),
      { flag: 'wx', mode: 0o600 },
    )

    for (const entry of readdirSync(locks)) {
      const other = inside(locks, entry)

      if (other === ticket || !existsSync(other)) {
        continue
      }

      let owner: Record<string, unknown>

      try {
        owner = json(path.join(other, 'owner.json'))
      } catch {
        if (!existsSync(other)) {
          continue
        }

        throw new Error(
          'Customization lock has no valid owner; inspect it before recovery',
        )
      }

      if (
        typeof owner.pid !== 'number' ||
        !Number.isSafeInteger(owner.pid) ||
        owner.pid <= 0
      ) {
        throw new Error(
          'Customization lock has no valid owner; inspect it before recovery',
        )
      }

      try {
        process.kill(owner.pid, 0)
        throw new Error('Another customization command holds the lock')
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'ESRCH'
        ) {
          throw error
        }
      }

      rmSync(other, { recursive: true, force: true })
    }

    return operation(directory)
  } finally {
    rmSync(ticket, { recursive: true, force: true })
  }
}

/** Apply only after complete preflight and syntax validation; retain private backups for this app build. */
export function applyCustomizations(
  bundle: CustomizationBundle,
  options: CustomizationOptions,
  checkSyntax = syntaxCheck,
): CustomizationPlan {
  return locked(options, (directory) => {
    const plan = planCustomizations(bundle, options)

    if (plan.state === 'applied') {
      return plan
    }

    const recordFile = path.join(directory, 'backup.json')

    if (existsSync(recordFile)) {
      throw new Error(
        'A backup already exists; revert this bundle before applying a changed baseline, or select a new --state-dir',
      )
    }

    for (const change of plan.changes) {
      checkSyntax(change.file, change.after, directory)
    }

    const record: Backup = {
      app: realpathSync(options.appRoot),
      version: plan.version,
      commit: plan.commit,
      files: [],
    }

    for (const [index, change] of plan.changes.entries()) {
      const backup = `${index}.before`
      writeFileSync(path.join(directory, backup), change.before, {
        flag: 'wx',
        mode: 0o600,
      })
      record.files.push({
        file: change.file,
        before: digest(change.before),
        after: digest(change.after),
        backup,
      })
    }

    atomicWrite(
      recordFile,
      Buffer.from(`${JSON.stringify(record, null, 2)}\n`),
      0o600,
    )
    transaction(plan.changes)
    return planCustomizations(bundle, options)
  })
}

/** Restore only files still matching this bundle's recorded result; preserve subsequent operator edits by refusing. */
export function revertCustomizations(
  bundle: CustomizationBundle,
  options: CustomizationOptions,
): void {
  locked(options, (directory) => {
    const recordFile = path.join(directory, 'backup.json')
    const record = json(recordFile)
    const app = realpathSync(options.appRoot)
    const packageVersion = json(path.join(app, 'package.json')).version
    const currentCommit = json(path.join(app, 'product.json')).commit

    if (
      record.app !== app ||
      record.version !== packageVersion ||
      record.commit !== currentCommit ||
      !Array.isArray(record.files)
    ) {
      throw new Error(
        'Backup belongs to another VS Code build; an update requires a fresh audit',
      )
    }

    const allowed = new Set([
      inside(app, 'product.json'),
      ...bundle.patches.flatMap((patch) =>
        patch.targets.map((target) => inside(app, target)),
      ),
      ...settingsFiles(options),
    ])
    const changes: Change[] = []

    for (const item of record.files) {
      const entry = object(item)
      const file = text(entry.file)
      const backup = text(entry.backup)

      if (!allowed.has(file) || !/^\d+\.before$/.test(backup)) {
        throw new Error('Backup contains an unauthorized path')
      }

      const after = readFileSync(inside(directory, backup))
      const before = readFileSync(file)

      if (digest(after) !== entry.before) {
        throw new Error('Backup integrity check failed')
      }

      if (digest(before) === entry.before) {
        continue
      } else if (digest(before) !== entry.after) {
        throw new Error(`Changed after apply; refusing to overwrite: ${file}`)
      }

      changes.push({ file, before, after })
    }

    transaction(changes)
    rmSync(recordFile)

    for (const item of record.files) {
      rmSync(path.join(directory, text(object(item).backup)))
    }
  })
}
