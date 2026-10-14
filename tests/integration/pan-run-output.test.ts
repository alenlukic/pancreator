import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { createTestTempDirectory } from '../temp.js'
import { findLatestLogDir, readRecord, runPanRun } from './pan-run-fixture.js'

test('AC-07 through AC-09: large shell bodies spool with a descriptor and no body in argv', () => {
  const root = createTestTempDirectory('pan-run-argv-limit-')
  const body = `# ${'€'.repeat(1400)}\nps -o command= -p $$ > executed-argv.txt\nprintf 'spooled\\n'\n`
  const result = runPanRun(
    ['--cwd', root, '--label', 'large-body', '-c', body],
    { root },
  )

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'spooled\n')
  assert.doesNotMatch(result.stderr, /ARGV_ELEMENT_TOO_LARGE/u)
  const record = readRecord(root)
  const script = path.join(root, String(record.script_path))

  assert.equal(path.dirname(script), findLatestLogDir(root))
  assert.deepEqual(record.command, ['bash', script])
  assert.equal(readFileSync(script, 'utf8'), body)
  assert.deepEqual(record.script_descriptor, {
    interpreter: 'bash',
    lines: 3,
    bytes: Buffer.byteLength(body),
  })
  assert.ok(!JSON.stringify(record).includes('€'.repeat(20)))
  const executed = readFileSync(
    path.join(root, 'executed-argv.txt'),
    'utf8',
  ).trim()

  assert.equal(executed, `bash ${script}`)
  assert.match(result.stderr, /script bash lines=3 bytes=\d+/u)
})

test('AC-11, AC-13, AC-14: synthetic interpreter output is bounded and spool redaction preserves execution', () => {
  const root = createTestTempDirectory('pan-run-summary-')
  const secret = 'synthetic-secret-value'
  const minified = `(()=>{${'x=1;'.repeat(300)}})();`
  const body =
    `# ${'python body '.repeat(400)}\n` +
    `test '${secret}' = "$MY_TOKEN" || exit 9\n` +
    `printf '  JavaScript:  ${minified}\\nPython:   ${'print(1);'.repeat(200)}\\n${secret}\\n'\n`
  const result = runPanRun(['--label', `fixture-${secret}`, '-c', body], {
    root,
    env: { MY_TOKEN: secret, PAN_RUN_LINE_WIDTH: '120' },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /JavaScript: .* \[truncated; original=\d+\]/u)
  assert.match(result.stdout, /Python: .* \[truncated; original=\d+\]/u)
  assert.match(result.stdout, /\[REDACTED:MY_TOKEN\]/u)
  for (const line of `${result.stdout}${result.stderr}`.split('\n')) {
    assert.ok(line.length <= 120, `line exceeds width: ${line}`)
  }
  const dir = findLatestLogDir(root)!

  for (const name of readdirSync(dir)) {
    assert.ok(
      !readFileSync(path.join(dir, name), 'utf8').includes(secret),
      name,
    )
  }
  assert.ok(!result.stderr.includes(secret))
  assert.match(
    readFileSync(path.join(dir, 'script.sh'), 'utf8'),
    /\[REDACTED:MY_TOKEN\]/u,
  )
  assert.ok(
    readFileSync(path.join(dir, 'output.log'), 'utf8').includes(minified),
  )
})
