import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'

const PAN_UNSTICK = path.join(process.cwd(), 'bin', 'pan-unstick')

interface LauncherFixture {
  child: ChildProcess
  pid: number
  catPid: number
  output: () => string
  stop: () => void
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(check: () => boolean, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs

  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor deadline passed')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

/** Waits until `ps` reports at least `seconds` of elapsed time for `pid`. */
async function waitForAge(pid: number, seconds: number) {
  const etimeSeconds = (): number => {
    const etime = spawnSync('ps', ['-o', 'etime=', '-p', String(pid)], {
      encoding: 'utf8',
    }).stdout.trim()
    const parts = etime.split(':').map(Number)

    return parts.reduce((total, part) => total * 60 + part, 0)
  }

  await waitFor(() => etimeSeconds() >= seconds)
}

/**
 * A process whose `cat` child blocks on fd 3. With `signature`, its command
 * line carries the Cursor launcher signature; without it, the parent is a
 * plain bash.
 */
async function startLauncher(signature: boolean): Promise<LauncherFixture> {
  const dir = createTestTempDirectory('pan-unstick-fixture-')
  const script = path.join(dir, 'launcher.sh')
  const catPidFile = path.join(dir, 'cat.pid')
  // Single quotes keep the signature literal in the launcher's argv.
  const name = signature
    ? `exec -a 'zsh -c snap=$(command cat <&3) rest' bash -c '`
    : "exec bash -c '"
  writeFileSync(
    script,
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      name,
      '/bin/cat <&3 &',
      `echo $! >${catPidFile}`,
      'wait $!',
      'echo released',
      "' 3< <(sleep 300)",
      '',
    ].join('\n'),
  )
  chmodSync(script, 0o755)

  const child = spawn('bash', [script], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk))

  assert.ok(child.pid)
  const pid = child.pid
  const stop = (): void => {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      // Already gone.
    }
  }

  try {
    await waitFor(
      () =>
        existsSync(catPidFile) &&
        readFileSync(catPidFile, 'utf8').trim() !== '',
    )
  } catch (error) {
    stop()
    throw error
  }

  return {
    child,
    pid,
    catPid: Number(readFileSync(catPidFile, 'utf8').trim()),
    output: () => stdout,
    stop,
  }
}

function unstick(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(PAN_UNSTICK, args, {
    encoding: 'utf8',
    env,
    timeout: 20_000,
  })
}

/** An environment whose `ps` prints `lines` as its snapshot. */
function psSnapshotEnv(dir: string, lines: string[]): NodeJS.ProcessEnv {
  const snapshot = path.join(dir, 'snapshot.txt')
  writeFileSync(snapshot, `${lines.join('\n')}\n`)

  const shim = path.join(dir, 'ps')
  writeFileSync(shim, `#!/usr/bin/env bash\ncat ${JSON.stringify(snapshot)}\n`)
  chmodSync(shim, 0o755)

  return { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` }
}

test('AC-03: releases a stalled launcher cat and the launcher completes', async () => {
  const launcher = await startLauncher(true)

  try {
    await waitForAge(launcher.catPid, 1)

    const result = unstick([
      '--launcher-pid',
      String(launcher.pid),
      '--min-age-seconds',
      '1',
    ])

    assert.equal(result.status, 0, result.stderr)
    assert.match(
      result.stdout,
      new RegExp(
        `^\\[pan-unstick\\] released launcher pid=${launcher.pid} cat pid=${launcher.catPid} age=\\d+s$`,
        'mu',
      ),
    )

    // The launcher prints this only after its cat ended and its wait returned.
    await waitFor(() => /released/u.test(launcher.output()))
  } finally {
    launcher.stop()
  }
})

test('AC-04: an unsigned parent, a young launcher, and a dry run are left alone', async (t) => {
  await t.test(
    'a cat whose parent lacks the signature is left alone',
    async () => {
      const plain = await startLauncher(false)

      try {
        await waitForAge(plain.catPid, 1)

        const result = unstick([
          '--launcher-pid',
          String(plain.pid),
          '--min-age-seconds',
          '1',
        ])

        assert.equal(result.status, 3)
        assert.match(
          result.stderr,
          /^\[pan-unstick\] no stalled launcher found$/mu,
        )
        assert.equal(result.stdout, '')
        assert.equal(processAlive(plain.catPid), true)
      } finally {
        plain.stop()
      }
    },
  )

  await t.test(
    'a launcher younger than the minimum age is left alone',
    async () => {
      const young = await startLauncher(true)

      try {
        const result = unstick([
          '--launcher-pid',
          String(young.pid),
          '--min-age-seconds',
          '3600',
        ])

        assert.equal(result.status, 3)
        assert.match(result.stderr, /no stalled launcher found/u)
        assert.equal(processAlive(young.catPid), true)
      } finally {
        young.stop()
      }
    },
  )

  await t.test(
    'a dry run names a qualifying launcher and signals nothing',
    async () => {
      const qualifying = await startLauncher(true)

      try {
        await waitForAge(qualifying.catPid, 1)

        const result = unstick([
          '--dry-run',
          '--launcher-pid',
          String(qualifying.pid),
          '--min-age-seconds',
          '1',
        ])

        assert.equal(result.status, 0, result.stderr)
        assert.match(
          result.stdout,
          new RegExp(
            `^\\[pan-unstick\\] would release launcher pid=${qualifying.pid} cat pid=${qualifying.catPid} age=\\d+s$`,
            'mu',
          ),
        )
        assert.equal(processAlive(qualifying.catPid), true)
        assert.equal(processAlive(qualifying.pid), true)
      } finally {
        qualifying.stop()
      }
    },
  )
})

test('a leading-zero minimum age is read as decimal', () => {
  const dir = createTestTempDirectory('pan-unstick-decimal-')
  const env = psSnapshotEnv(dir, [
    '40000 1 00:10 /bin/zsh -c snap=$(command cat <&3)',
    '40001 40000 00:10 /bin/cat',
  ])

  const result = unstick(['--dry-run', '--min-age-seconds', '09'], env)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    '[pan-unstick] would release launcher pid=40000 cat pid=40001 age=10s\n',
  )
})

test('one scan of a large process snapshot finds every stalled launcher', () => {
  const dir = createTestTempDirectory('pan-unstick-snapshot-')
  const lines: string[] = []
  const filler = 'é'.repeat(200)

  // Long multibyte command lines, as a developer host holds, beside fifty
  // launchers that each have one old cat child and one young cat child.
  for (let index = 0; index < 700; index += 1) {
    const pid = 10_000 + index
    const width = index % 35 === 0 ? 45 : 1
    lines.push(`${pid} 1 01:00:00 /usr/bin/app --flag ${filler.repeat(width)}`)
  }

  for (let index = 0; index < 50; index += 1) {
    const launcher = 20_000 + index * 3
    lines.push(
      `${launcher} 1 05:00 /bin/zsh -c snap=$(command cat <&3) ; ${filler}`,
      `${launcher + 1} ${launcher} 04:59 /bin/cat`,
      `${launcher + 2} ${launcher} 00:01 cat`,
    )
  }

  lines.push(
    '30000 1 1-02:00:00 bash -c snap=x; cat <&3',
    '30001 30000 1-01:00:00 cat',
  )
  const result = unstick(['--dry-run', '--min-age-seconds', '5'], {
    ...psSnapshotEnv(dir, lines),
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  })

  assert.equal(
    result.error,
    undefined,
    'the scan finished before the hang guard',
  )
  assert.equal(result.status, 0, result.stderr)

  // The young cats and the launcher without the exact signature stay out.
  assert.deepEqual(
    result.stdout.split('\n').filter(Boolean),
    Array.from({ length: 50 }, (_, index) => {
      const launcher = 20_000 + index * 3

      return `[pan-unstick] would release launcher pid=${launcher} cat pid=${launcher + 1} age=299s`
    }),
  )
})
