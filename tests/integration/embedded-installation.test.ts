import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()
const INSTALLER = path.join(REPO_ROOT, 'bin', 'pancreator-install')

function makeSkeletonProject(): string {
  const project = mkdtempSync(path.join(tmpdir(), 'pancreator-embed-'))

  writeFileSync(path.join(project, 'README.md'), '# skeleton\n')

  return project
}

function runInstaller(
  project: string,
  args: string[] = [],
): { stdout: string; stderr: string; status: number } {
  const result = execFileSync(INSTALLER, ['--target', project, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  return {
    stdout: result,
    stderr: '',
    status: 0,
  }
}

function runInstallerExpectFailure(
  project: string,
  args: string[],
): { stdout: string; stderr: string; status: number | null } {
  try {
    const stdout = execFileSync(INSTALLER, ['--target', project, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    return { stdout, stderr: '', status: 0 }
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      stdout?: string
      stderr?: string
      status?: number | null
    }

    return {
      stdout: execError.stdout ?? '',
      stderr: execError.stderr ?? '',
      status: execError.status ?? null,
    }
  }
}

test('embedded installer creates project configuration on a skeleton project', () => {
  const project = makeSkeletonProject()

  try {
    const result = runInstaller(project)

    assert.equal(result.status, 0)

    const config = JSON.parse(
      readFileSync(path.join(project, '.pancreator', 'project.json'), 'utf8'),
    ) as {
      schema_version: number
      workspace_id: string
      state_root: string
      tracking: { exclude: string[] }
    }

    assert.equal(config.schema_version, 1)
    assert.equal(config.state_root, '.pancreator/runtime')
    assert.ok(config.workspace_id.length > 0)
    assert.ok(config.tracking.exclude.includes('dist/**'))
    assert.ok(config.tracking.exclude.includes('node_modules/**'))
    assert.match(result.stdout, /Pancreator embedded/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer reruns idempotently with --yes', () => {
  const project = makeSkeletonProject()

  try {
    runInstaller(project)
    const result = runInstaller(project, ['--yes'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Idempotent rerun completed/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer repairs partial installations', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })
    writeFileSync(
      path.join(project, '.pancreator', 'project.json'),
      '{"schema_version":1}\n',
    )

    const result = runInstaller(project, ['--repair'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Repair completed/)

    const config = JSON.parse(
      readFileSync(path.join(project, '.pancreator', 'project.json'), 'utf8'),
    ) as { tracking: { exclude: string[] } }

    assert.ok(config.tracking.exclude.includes('dist/**'))
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer performs clean reinstall', () => {
  const project = makeSkeletonProject()

  try {
    runInstaller(project)
    writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

    const result = runInstaller(project, ['--clean'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Clean reinstall completed/)
    assert.throws(() =>
      readFileSync(path.join(project, '.pancreator', 'stale.txt')),
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer aborts partial installs without an explicit choice', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })

    const result = runInstallerExpectFailure(project, [])

    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /partial installation detected/)
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer partial-install --choice r repairs interactively', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })
    writeFileSync(
      path.join(project, '.pancreator', 'project.json'),
      '{"schema_version":1}\n',
    )

    const result = runInstaller(project, ['--choice', 'r'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Repair completed/)
    assert.ok(
      readFileSync(path.join(project, '.pancreator', 'install.json'), 'utf8')
        .length > 0,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer partial-install --choice c cleans and reinstalls', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })
    writeFileSync(path.join(project, '.pancreator', 'stale.txt'), 'old\n')

    const result = runInstaller(project, ['--choice', 'c'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Clean reinstall completed/)
    assert.throws(() =>
      readFileSync(path.join(project, '.pancreator', 'stale.txt')),
    )
    assert.ok(
      readFileSync(path.join(project, '.pancreator', 'project.json'), 'utf8')
        .length > 0,
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer partial-install --choice a aborts without changes', () => {
  const project = makeSkeletonProject()

  try {
    mkdirSync(path.join(project, '.pancreator'), { recursive: true })

    const result = runInstaller(project, ['--choice', 'a'])

    assert.equal(result.status, 0)
    assert.match(result.stdout, /Aborted/)
    assert.throws(() =>
      readFileSync(path.join(project, '.pancreator', 'project.json')),
    )
  } finally {
    rmSync(project, { recursive: true, force: true })
  }
})

test('embedded installer scripted smoke verification passes', () => {
  const stdout = execFileSync(INSTALLER, ['--smoke'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  assert.match(stdout, /smoke: all steps passed/)
  assert.match(stdout, /smoke: fresh install/)
  assert.match(stdout, /smoke: partial install repair/)
  assert.match(stdout, /smoke: partial install clean/)
  assert.match(stdout, /smoke: partial install abort/)
})
