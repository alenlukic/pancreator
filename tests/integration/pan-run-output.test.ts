import assert from 'node:assert/strict'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  assert.doesNotMatch(result.stderr, /script bash|started pid=/u)
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

// Keep the redaction holdback deterministic without depending on a developer's
// API tokens or other credentials. The synthetic runner uses the actual CLI
// argv shape recognized by pan-run, not a separate output implementation.
function clauseEnv(): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.keys(process.env)
        .filter((name) =>
          /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|SESSION/iu.test(
            name,
          ),
        )
        .map((name) => [name, undefined]),
    ),
    MY_TOKEN: 'zzzzzzzzz',
  }
}

test('policy pull preserves Unicode across redaction holdback and idle flush', () => {
  const root = createTestTempDirectory('pan-run-clause-unicode-')
  const cli = path.join(root, 'cli.js')
  // 10 UTF-16 code units minus the 8-unit secret holdback used to cut
  // between the two surrogates of the emoji. Delay the final newline so the
  // output really crosses both a data event and an idle flush.
  const body = '界🙂xxxxxxx'
  writeFileSync(
    cli,
    `process.stdout.write(${JSON.stringify(body)}); setTimeout(() => process.stdout.write('\\n'), 800);\n`,
  )
  const result = runPanRun(
    ['--cwd', root, '--', 'node', cli, 'governance', 'clause'],
    {
      root,
      env: clauseEnv(),
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, body + '\n')
  assert.equal(
    readFileSync(path.join(findLatestLogDir(root)!, 'output.log'), 'utf8'),
    body + '\n',
  )
})

test('policy pull retries short and interrupted writes without dropping bytes or redaction', () => {
  const root = createTestTempDirectory('pan-run-clause-short-write-')
  const cli = path.join(root, 'cli.js')
  const preload = path.join(root, 'short-writes.cjs')
  const secret = 'zzzzzzzzz'
  const body =
    '界🙂 normative  text. '.repeat(700) + secret + '\nEND-OF-CLAUSE.\n'
  const expected = body.replace(secret, '[REDACTED:MY_TOKEN]')
  writeFileSync(cli, `process.stdout.write(${JSON.stringify(body)});\n`)
  // Simulate legal short byte writes and transient errors on the actual filter
  // process. Limit each write to 7 bytes, which can also split UTF-8 characters.
  // Other helper modes and the CLI itself must execute normally.
  writeFileSync(
    preload,
    `
const fs = require('node:fs');
if (process.argv[1]?.endsWith('/.pan-run.cjs') && process.argv[2] === 'filter') {
  const original = fs.writeSync;
  const calls = new Map();
  fs.writeSync = function(fd, data, ...args) {
    const count = (calls.get(fd) || 0) + 1;
    calls.set(fd, count);
    if (count === 2 || count === 3) {
      const code = count === 2 ? 'EINTR' : 'EAGAIN';
      throw Object.assign(new Error(code), { code });
    }
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    const offset = typeof data === 'string' ? 0 : (args[0] ?? 0);
    const length = typeof data === 'string' ? buffer.length : (args[1] ?? buffer.length - offset);
    return original.call(fs, fd, buffer, offset, Math.min(length, 7), null);
  };
}
`,
  )
  const result = runPanRun(
    ['--cwd', root, '--', 'node', cli, 'governance', 'clause'],
    {
      root,
      env: {
        ...clauseEnv(),
        NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
      },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, expected)
  assert.equal(
    readFileSync(path.join(findLatestLogDir(root)!, 'output.log'), 'utf8'),
    expected,
  )
  assert.doesNotMatch(result.stdout, /\[truncated; original=/u)
  assert.ok(!result.stdout.includes(secret))
})
