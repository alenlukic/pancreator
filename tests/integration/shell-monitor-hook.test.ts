import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

const HOOK = path.join(process.cwd(), 'bin', 'pan-hook-shell-monitor')
const TIMEOUT_MS = 10_000

function runHook(command: string) {
  const payload = JSON.stringify({ command, cwd: '/tmp' })

  const result = spawnSync(HOOK, {
    input: payload,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  })

  const raw = result.stdout.trim()

  let parsed: unknown = null

  try {
    parsed = JSON.parse(raw)
  } catch {
    // Will fail assertions
  }

  return { raw, parsed, stderr: result.stderr, status: result.status }
}

function permission(command: string): string {
  const { parsed } = runHook(command)

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'permission' in parsed &&
    typeof (parsed as Record<string, unknown>).permission === 'string'
  ) {
    return (parsed as Record<string, string>).permission
  }

  return 'error'
}

test('AC-18: shell-monitor hook allow and deny cases', async (t) => {
  // ---- wrapped form ----

  await t.test('allows wrapped form with ./bin/pan-run --', () => {
    assert.equal(permission('./bin/pan-run -- npm test'), 'allow')
  })

  await t.test('allows wrapped form with bin/pan-run -c', () => {
    assert.equal(permission("bin/pan-run -c 'npm test'"), 'allow')
  })

  await t.test('allows wrapped form with absolute bin/pan-run path', () => {
    assert.equal(
      permission('/absolute/path/to/bin/pan-run -- echo hi'),
      'allow',
    )
  })

  await t.test('allows wrapped form with .pancreator/bin/pan-run', () => {
    assert.equal(permission('.pancreator/bin/pan-run -- ls'), 'allow')
  })

  await t.test('allows wrapped form with leading env assignment', () => {
    assert.equal(permission('FOO=bar ./bin/pan-run -- echo ok'), 'allow')
  })

  // ---- allowlisted commands ----

  await t.test('allows git status', () => {
    assert.equal(permission('git status'), 'allow')
  })

  await t.test('allows git log', () => {
    assert.equal(permission('git log'), 'allow')
  })

  await t.test('allows git diff', () => {
    assert.equal(permission('git diff HEAD'), 'allow')
  })

  await t.test('allows git show', () => {
    assert.equal(permission('git show HEAD'), 'allow')
  })

  await t.test('allows git rev-parse', () => {
    assert.equal(permission('git rev-parse HEAD'), 'allow')
  })

  await t.test('allows ls', () => {
    assert.equal(permission('ls'), 'allow')
  })

  await t.test('allows ls with args', () => {
    assert.equal(permission('ls -la /tmp'), 'allow')
  })

  await t.test('allows rg', () => {
    assert.equal(permission('rg "TODO" src/'), 'allow')
  })

  await t.test('allows cat', () => {
    assert.equal(permission('cat README.md'), 'allow')
  })

  await t.test('allows pwd', () => {
    assert.equal(permission('pwd'), 'allow')
  })

  await t.test('allows chains of allowlisted commands', () => {
    assert.equal(permission('git status && ls'), 'allow')
  })

  await t.test('allows allowlisted with 2>/dev/null', () => {
    assert.equal(permission('git status 2>/dev/null'), 'allow')
  })

  // ---- denied: unwrapped commands ----

  await t.test('denies unwrapped npm test', () => {
    assert.equal(permission('npm test'), 'deny')
  })

  await t.test('denies unwrapped node', () => {
    assert.equal(permission('node -e "console.log(1)"'), 'deny')
  })

  await t.test('denies allowlisted command piped into non-allowlisted', () => {
    assert.equal(permission('git log | grep foo'), 'deny')
  })

  await t.test('denies allowlisted chained with non-allowlisted', () => {
    assert.equal(permission('git status && npm install'), 'deny')
  })

  // ---- denied: command substitutions ----

  await t.test('denies $(...) outside single quotes', () => {
    assert.equal(permission('echo $(date)'), 'deny')
  })

  await t.test('denies backtick substitution', () => {
    assert.equal(permission('echo `date`'), 'deny')
  })

  await t.test('denies <(...) process substitution', () => {
    assert.equal(permission('cat <(echo hi)'), 'deny')
  })

  // ---- denied: refused flags ----

  await t.test('denies git with -c flag', () => {
    assert.equal(permission('git -c core.pager=cat log'), 'deny')
  })

  await t.test('denies git log --output', () => {
    assert.equal(permission('git log --output=/tmp/out'), 'deny')
  })

  await t.test('denies rg --pre', () => {
    assert.equal(permission('rg --pre script.sh .'), 'deny')
  })

  await t.test('denies rg --search-zip', () => {
    assert.equal(permission('rg --search-zip .'), 'deny')
  })

  // ---- output format ----

  await t.test('allow response is {"permission":"allow"}', () => {
    const result = runHook('git status')
    const parsed = result.parsed as Record<string, unknown>

    assert.equal(parsed?.permission, 'allow')
    assert.deepEqual(Object.keys(parsed ?? {}), ['permission'])
  })

  await t.test(
    'deny response has permission, user_message, agent_message',
    () => {
      const result = runHook('npm test')
      const parsed = result.parsed as Record<string, unknown>

      assert.equal(parsed?.permission, 'deny')
      assert.ok(
        typeof parsed?.user_message === 'string',
        'must have user_message',
      )
      assert.ok(
        typeof parsed?.agent_message === 'string',
        'must have agent_message',
      )
    },
  )

  await t.test('agent_message names the wrapper path on deny', () => {
    const result = runHook('npm test')
    const parsed = result.parsed as Record<string, unknown>

    assert.ok(
      typeof parsed?.agent_message === 'string' &&
        (parsed.agent_message as string).includes('bin/pan-run'),
      'agent_message must name bin/pan-run',
    )
  })

  await t.test('hook exits 0 on every input including deny', () => {
    const allow = runHook('git status')
    const deny = runHook('npm test')

    assert.equal(allow.status, 0, 'allow exits 0')
    assert.equal(deny.status, 0, 'deny exits 0')
  })
})
