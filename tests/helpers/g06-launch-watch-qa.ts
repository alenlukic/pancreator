/** Independent QA only: one real cadence, no paid model and no test discovery. */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  chmodSync,
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  delegationLivePaths,
  type DelegationLiveIdentity,
} from '../../src/lib/executors/delegation-live.js'
import { resolveShellRecord } from '../../src/lib/watch/process.js'
import {
  processRunning,
  processStartIdentity,
} from '../../src/lib/watch/process-evidence.js'
import { recordInvocationLaunch } from '../../src/lib/watch/launch.js'
import { workerLifetime } from '../../src/lib/watch/lifetime.js'
import { summarizeDelegationWatch } from '../../src/lib/watch/record.js'
import { watchRecordPath } from '../../src/lib/watch/paths.js'
import { appendBlockingReceipt } from '../../src/lib/watch/blocking.js'
import type { GenericWatchRecordEntry } from '../../src/lib/watch/process.js'
import {
  loadProjectConfig,
  readHarnessConfig,
} from '../../src/lib/project-config.js'
import { parsePipelineConfig } from '../../src/lib/pipeline-config.js'

function provisionFixtureConfiguration(root: string, scratch: string): void {
  copyFileSync(
    path.join(root, 'config.json'),
    path.join(scratch, 'config.json'),
  )
  const tiers = {
    balanced: 'cursor:gpt-5.6-sol',
    advanced: 'cursor:gpt-5.6-sol',
    ultra: 'cursor:gpt-5.6-sol',
  }
  writeFileSync(
    path.join(scratch, 'config_overrides.json'),
    JSON.stringify(
      {
        model_config: {
          anthropic: tiers,
          oai: tiers,
          open: tiers,
          cursor: tiers,
        },
      },
      null,
      2,
    ) + '\n',
  )
  loadProjectConfig(scratch)
  parsePipelineConfig(
    readHarnessConfig(scratch, path.join(scratch, 'config.json')),
  )
}

const root = process.cwd()
const scratch = path.join(
  root,
  'runtime/verification-execution/g06-launch-watch',
)
mkdirSync(scratch, { recursive: true })
writeFileSync(
  path.join(scratch, 'package.json'),
  JSON.stringify({ name: 'pancreator-v2-prototype', type: 'module' }),
)
const started = Date.now()
const observations: Array<Record<string, unknown>> = []
const children: ChildProcess[] = []
const identity: DelegationLiveIdentity = {
  run_id: 'g06-independent-qa',
  invocation_id: `g06-qa-${randomUUID()}`,
  role: 'stage',
  attempt: 1,
  launch_id: `qa-${started}`,
}
const save = (name: string, value: unknown) =>
  writeFileSync(path.join(scratch, name), JSON.stringify(value, null, 2) + '\n')
for (const name of ['launch.json', 'shell-record.json', 'exit.json']) {
  save(name, { status: 'not_started' })
}
writeFileSync(path.join(scratch, 'watch.jsonl'), '')
const binary = path.join(scratch, 'controlled-copilot')
const childScript = `${binary}.mjs`
const childReceipt = path.join(scratch, 'controlled-child.json')
const descendantReceipt = path.join(scratch, 'controlled-descendant.json')
for (const receipt of [childReceipt, descendantReceipt]) {
  if (existsSync(receipt)) unlinkSync(receipt)
}
writeFileSync(
  childScript,
  `
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 100000)'], {stdio:'ignore'})
descendant.unref()
process.on('SIGTERM', () => { descendant.kill('SIGTERM'); process.exit(143) })
writeFileSync(${JSON.stringify(descendantReceipt)}, JSON.stringify({pid:descendant.pid}))
writeFileSync(${JSON.stringify(childReceipt)}, JSON.stringify({pid:process.pid,started_at:new Date().toISOString()}))
for await (const chunk of process.stdin) {}
setTimeout(() => {
  const session = process.argv.find(arg => arg.startsWith('--session-id='))?.slice(13)
  process.stdout.write(JSON.stringify({type:'result',sessionId:session,exitCode:0}) + '\\n', () => process.exit(0))
}, 70000)
`,
)
writeFileSync(
  binary,
  `#!/bin/bash\nexec "${process.execPath}" "${childScript}" "$@"\n`,
)
chmodSync(binary, 0o755)
let shellDirectory: string | null = null
let descendantIdentity: string | null = null
let failed: unknown
async function closeChild(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true
  const closed = once(child, 'close').then(() => true)
  for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
    let timer: ReturnType<typeof setTimeout> | undefined
    child.kill(signal)
    const ended = await Promise.race([
      closed,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), 2000)
      }),
    ])
    clearTimeout(timer)
    if (ended) return true
  }
  return false
}
try {
  provisionFixtureConfiguration(root, scratch)
  assert.ok(
    processStartIdentity(process.pid),
    'Environment cannot establish process start identity; live QA cannot launch safely.',
  )
  const relay = fileURLToPath(
    new URL('../../src/lib/executors/copilot-relay.js', import.meta.url),
  )
  const wrapper = spawn(
    path.join(root, 'bin/pan-run'),
    [
      '--summary',
      '--label',
      'g06-independent-quiet-worker',
      '--',
      process.execPath,
      relay,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PANCREATOR_ROOT: scratch,
        PAN_RUN_RECORD: '',
        PANCREATOR_COPILOT_BIN: binary,
        PAN_RUN_HEARTBEAT_SECONDS: '30',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  children.push(wrapper)
  const wrapperExit = once(wrapper, 'close')
  let transport = ''
  wrapper.stdout?.on('data', (chunk: Buffer) => {
    transport += chunk.toString()
  })
  wrapper.stderr?.on('data', (chunk: Buffer) => {
    transport += chunk.toString()
  })
  wrapper.stdin?.end(
    JSON.stringify({
      prompt: 'Controlled silent G06 QA worker.',
      cwd: scratch,
      model: 'test-model',
      availableTools: ['view'],
      addDirs: [],
      adapterParentPid: wrapper.pid,
      timeoutMs: 95000,
      live: { root: scratch, identity },
    }),
  )
  // Startup is bounded by observed receipt creation, never by an inferred success.
  const startup = Date.now()
  while (!existsSync(childReceipt) && Date.now() - startup < 15000) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
  assert.ok(
    existsSync(childReceipt),
    `Controlled worker did not start: ${transport}`,
  )
  const shell = resolveShellRecord(scratch, 'latest')
  shellDirectory = shell.directory
  const child = JSON.parse(readFileSync(childReceipt, 'utf8')) as {
    pid: number
  }
  observations.push({
    event: 'launch_bound',
    at: new Date().toISOString(),
    shell: shell.directory,
    child_pid: child.pid,
    child_start_identity: processStartIdentity(child.pid),
    process_running: processRunning(child.pid),
    tty: false,
  })
  assert.ok(processRunning(child.pid))
  const descendant = JSON.parse(readFileSync(descendantReceipt, 'utf8')) as {
    pid: number
  }
  descendantIdentity = processStartIdentity(descendant.pid)
  assert.ok(descendantIdentity, 'Cannot establish descendant process identity.')
  const livePath = delegationLivePaths(scratch, identity).record
  const live = JSON.parse(readFileSync(livePath, 'utf8')) as {
    launched_at: string
  }
  recordInvocationLaunch(scratch, identity.run_id, identity.invocation_id, {
    launchedAt: live.launched_at,
    defaultLaunchedAtMs: Date.now(),
    defaultSource: 'watch_arm',
    workerHandle: `copilot:${identity.launch_id}`,
  })
  save('launch.json', { ...identity, ...live, shell_record: shell.directory })
  const cli = fileURLToPath(new URL('../../src/cli.js', import.meta.url))
  // The CLI watches the isolated wrapper via its absolute, already pinned record.
  const blockingStartedAt = new Date().toISOString()
  const watcher = spawn(
    process.execPath,
    [
      cli,
      'watch',
      '--shell',
      shell.directory,
      '--timeout-seconds',
      '110',
      '--json',
    ],
    {
      cwd: scratch,
      env: { ...process.env, PANCREATOR_ROOT: scratch },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  children.push(watcher)
  assert.ok(watcher.pid)
  const watcherIdentity = processStartIdentity(watcher.pid)
  assert.ok(watcherIdentity, 'Cannot establish watcher identity.')
  let watched = ''
  let diagnostics = ''
  watcher.stdout?.on('data', (chunk: Buffer) => {
    watched += chunk.toString()
  })
  watcher.stderr?.on('data', (chunk: Buffer) => {
    diagnostics += chunk.toString()
  })
  const [watchCode] = await once(watcher, 'close')
  const blockingEndedAt = new Date().toISOString()
  assert.equal(watchCode, 0, diagnostics)
  const result = JSON.parse(watched) as { record_path: string; state: string }
  assert.equal(result.state, 'exited')
  copyFileSync(
    path.join(scratch, result.record_path),
    path.join(scratch, 'watch.jsonl'),
  )
  const entries = readFileSync(path.join(scratch, 'watch.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as GenericWatchRecordEntry)
  const wakes = entries.filter((entry) => entry.event === 'wake')
  const quietWake = wakes.find((entry) => !entry.terminal_state)
  assert.ok(quietWake, 'No real scheduled nonterminal wake was recorded.')
  assert.ok(Date.parse(String(quietWake.recorded_at)) - started >= 59000)
  assert.ok(quietWake.heartbeat, 'Quiet wake has no wrapper heartbeat.')
  assert.ok(quietWake.heartbeat.beat_age_seconds < 60)
  observations.push({ ...quietWake, event: 'quiet_cadence_wake' })
  const [wrapperCode] = await wrapperExit
  assert.equal(wrapperCode, 0, transport)
  const relayOutput = readFileSync(
    path.join(scratch, shell.output_path),
    'utf8',
  )
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as { ok?: boolean })
    .at(-1)
  assert.equal(
    relayOutput?.ok,
    true,
    'Relay did not report a successful result.',
  )
  const session = entries[0]!
  assert.equal(session.event, 'session_started')
  assert.equal(session.watcher_pid, watcher.pid)
  assert.equal(session.watcher_process_identity, watcherIdentity)
  // Attribute the actual generic observations to this controlled delegation.
  const ledger = watchRecordPath(
    scratch,
    identity.run_id,
    identity.invocation_id,
  )
  const attributed = entries.map((entry) => ({
    ...entry,
    run_id: identity.run_id,
    invocation_id: identity.invocation_id,
  }))
  writeFileSync(
    path.join(scratch, ledger),
    attributed.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
  )
  const blocking = {
    schema_version: 1 as const,
    ledger,
    watch_session_id: session.watch_session_id,
    watcher_pid: watcher.pid,
    watcher_process_identity: watcherIdentity,
    parent_pid: process.pid,
    parent_process_identity: processStartIdentity(process.pid)!,
    started_at: blockingStartedAt,
    ended_at: blockingEndedAt,
    result: 'exited',
  }
  appendBlockingReceipt(path.join(scratch, ledger), blocking)
  observations.push({ ...blocking, event: 'blocking_receipt' })
  const lifetimeBefore = workerLifetime(
    scratch,
    identity.run_id,
    identity.invocation_id,
  )
  assert.ok(lifetimeBefore.seconds !== null && lifetimeBefore.seconds >= 60)
  const coverageBefore = summarizeDelegationWatch(
    scratch,
    identity.run_id,
    identity.invocation_id,
  )
  assert.equal(coverageBefore.await_status, 'observed')
  assert.ok(
    coverageBefore.covered_seconds !== null &&
      coverageBefore.covered_seconds >= 50,
  )
  assert.ok(
    coverageBefore.coverage_ratio !== null &&
      coverageBefore.coverage_ratio > 0.5,
  )
  const output = path.join(scratch, shell.output_path)
  const outputBefore = readFileSync(output, 'utf8')
  appendFileSync(output, '\npostexit actual watched output edit\n')
  assert.notEqual(readFileSync(output, 'utf8'), outputBefore)
  const lifetimeAfter = workerLifetime(
    scratch,
    identity.run_id,
    identity.invocation_id,
  )
  assert.deepEqual(lifetimeAfter, lifetimeBefore)
  const coverageAfter = summarizeDelegationWatch(
    scratch,
    identity.run_id,
    identity.invocation_id,
  )
  assert.deepEqual(coverageAfter, coverageBefore)
  save('exit.json', {
    wrapper_code: wrapperCode,
    watch: result,
    lifetime_before: lifetimeBefore,
    lifetime_after: lifetimeAfter,
    coverage_before: coverageBefore,
    coverage_after: coverageAfter,
    edited_output: shell.output_path,
    child_exit: JSON.parse(readFileSync(livePath, 'utf8')),
    blocking_receipt: blocking,
    elapsed_ms: Date.now() - started,
  })
  assert.ok(Date.now() - started <= 120000, 'QA exceeded 120000ms.')
} catch (error) {
  failed = error
  observations.push({
    event: 'failure',
    message: error instanceof Error ? error.message : String(error),
  })
} finally {
  for (const child of children) {
    if (!(await closeChild(child))) {
      failed ??= new Error(`Could not stop launched process ${child.pid}.`)
    }
  }
  const descendant = existsSync(descendantReceipt)
    ? (JSON.parse(readFileSync(descendantReceipt, 'utf8')) as { pid: number })
    : null
  const alive = descendant ? processRunning(descendant.pid) : false
  if (
    alive &&
    descendant &&
    descendantIdentity !== null &&
    processStartIdentity(descendant.pid) === descendantIdentity
  ) {
    process.kill(descendant.pid, 'SIGKILL')
  }
  const cleanupBound = Date.now() + 2000
  while (
    descendant &&
    processRunning(descendant.pid) &&
    Date.now() < cleanupBound
  ) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
  const aliveAfterCleanup = descendant ? processRunning(descendant.pid) : false
  if (
    shellDirectory &&
    existsSync(path.join(scratch, shellDirectory, 'record.json'))
  )
    copyFileSync(
      path.join(scratch, shellDirectory, 'record.json'),
      path.join(scratch, 'shell-record.json'),
    )
  save('observations.json', observations)
  save('cleanup.json', {
    completed_at: new Date().toISOString(),
    descendant_pid: descendant?.pid ?? null,
    descendant_was_alive: alive,
    descendant_start_identity: descendantIdentity,
    descendant_cleanup: aliveAfterCleanup
      ? 'unresolved'
      : alive
        ? 'forced'
        : children.length > 0
          ? 'relay_cleanup'
          : 'not_started',
    descendant_alive_after_cleanup: aliveAfterCleanup,
    launched_processes: children.map((child) => ({
      pid: child.pid,
      exit_code: child.exitCode,
      signal: child.signalCode,
    })),
  })
  if (alive && !failed)
    failed = new Error('Relay left the controlled descendant alive.')
  if (aliveAfterCleanup) {
    failed ??= new Error('Controlled descendant remains alive after cleanup.')
  }
}
if (failed) throw failed
