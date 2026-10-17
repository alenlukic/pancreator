import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { createServer, type Socket } from 'node:net'

import { createCopilotAdapter } from '../../src/lib/engine/executors.js'
import {
  decideRun,
  getRunState,
  prepareInvocation,
} from '../../src/lib/engine.js'
import { operationMutexPath } from '../../src/lib/state.js'
import { processIsAlive, withOperationMutex } from '../../src/lib/io.js'
import {
  COPILOT_CLI_REQUIRED_FLAGS,
  copilotCliPreflight,
} from '../../src/lib/executors/copilot-cli.js'
import { parsePersonaMapping } from '../../src/lib/executors/mapping.js'
import type {
  ExternalDelegationRecord,
  StageDefinition,
} from '../../src/lib/types.js'
import { createTestTempDirectory } from '../temp.js'
import { pinFixturePersonaModel } from '../fixture-template.js'
import { makeOutput, writeJson } from '../helpers.js'
import { submitAsSupervisor } from '../run-helpers.js'
import { checkpoint, runWorkflow } from './delivery-helpers.js'
import { stageBySlug } from '../../src/lib/workflow.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import {
  loadDelegationLiveRecord,
  delegationLivePaths,
  type DelegationLiveRecord,
  type DelegationLiveIdentity,
} from '../../src/lib/executors/delegation-live.js'

const FAKE_KEY = 'sk-fake-copilot-key-0123456789'

function stage(policy: StageDefinition['workspace_policy']): StageDefinition {
  return { slug: 'implement', workspace_policy: policy } as StageDefinition
}

function harnessRoot(): string {
  const root = createTestTempDirectory('copilot-root-')
  writeFileSync(
    path.join(root, 'config.json'),
    JSON.stringify({ schema_version: 1, workspace_root: '.' }),
  )
  return root
}

/** A fake `copilot` that records its stdin and argv and prints JSONL. */
function fakeCopilot(
  options: { omitFlag?: string; revision?: boolean; root?: string } = {},
): string {
  const dir = options.root
    ? path.join(options.root, 'runtime', 'copilot-fixture')
    : createTestTempDirectory('copilot-bin-')
  mkdirSync(dir, { recursive: true })
  const help = COPILOT_CLI_REQUIRED_FLAGS.filter(
    (flag) => flag !== options.omitFlag,
  )
    .map((flag) => `      ${flag} <value>`)
    .join('\n')

  writeFileSync(path.join(dir, 'help.txt'), `Options:\n${help}\n`)
  writeFileSync(
    path.join(dir, 'copilot'),
    [
      '#!/bin/bash',
      'here="$(dirname "$0")"',
      'if [ "$1" = "--version" ]; then echo "GitHub Copilot CLI 1.0.90."; exit 0; fi',
      'if [ "$1" = "--help" ]; then cat "$here/help.txt"; exit 0; fi',
      ...(options.revision
        ? [`exec "${process.execPath}" "$here/revision.mjs" "$@"`]
        : []),
      'cat > "$here/stdin.txt"',
      'printf "%s\\n" "$@" > "$here/argv.txt"',
      'printf "%s\\n" "$COPILOT_ALLOW_ALL" "$COPILOT_PROVIDER_TYPE" "$PAN_HOST" "${CURSOR_CONVERSATION_ID-unset}" > "$here/env.txt"',
      'for arg in "$@"; do case "$arg" in --session-id=*|--resume=*) session="${arg#*=}";; esac; done',
      'echo "{\\"type\\":\\"assistant.message\\",\\"data\\":{\\"model\\":\\"${FAKE_MODEL}\\",\\"content\\":\\"done $COPILOT_PROVIDER_API_KEY\\"}}"',
      'echo "{\\"type\\":\\"result\\",\\"sessionId\\":\\"$session\\",\\"exitCode\\":0}"',
      '',
    ].join('\n'),
  )
  if (options.revision) {
    writeFileSync(
      path.join(dir, 'revision.mjs'),
      `
import fs from 'node:fs'
import net from 'node:net'
const argv = process.argv.slice(2)
const resumed = argv.some(arg => arg.startsWith('--resume='))
const countPath = new URL('fresh-count', import.meta.url)
const count = resumed ? 0 : (fs.existsSync(countPath) ? Number(fs.readFileSync(countPath)) : 0) + 1
if (!resumed) fs.writeFileSync(countPath, String(count))
const label = resumed ? 'session-resume' : count === 1 ? 'session-first' : 'session-fallback'
const session = argv.find(arg => arg.startsWith('--resume=') || arg.startsWith('--session-id='))?.split('=')[1]
let prompt = ''
for await (const chunk of process.stdin) prompt += chunk
fs.writeFileSync(new URL(label + '.json', import.meta.url), JSON.stringify({argv,prompt,session}))
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n')
emit({type:'session.start',data:{sessionId:session}})
emit({type:'assistant.message',data:{model:'gpt-5.6-sol',content:'done ' + process.env.COPILOT_PROVIDER_API_KEY}})
emit({type:'result',sessionId:session,exitCode:resumed ? 1 : 0})
const socket = net.connect(Number(process.env.COPILOT_REVISION_PORT), '127.0.0.1')
socket.on('data', () => { socket.destroy(); process.exit(resumed ? 1 : 0) })
`,
    )
  }
  chmodSync(path.join(dir, 'copilot'), 0o755)
  return path.join(dir, 'copilot')
}

function withEnv<T>(
  values: Record<string, string | undefined>,
  run: () => T,
): T {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  )

  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }

  try {
    return run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
}

test('preflight names a flag the installed CLI no longer offers', () => {
  withEnv({ PANCREATOR_COPILOT_BIN: fakeCopilot() }, () => {
    assert.deepEqual(copilotCliPreflight().ok, true)
  })
  withEnv(
    { PANCREATOR_COPILOT_BIN: fakeCopilot({ omitFlag: '--available-tools' }) },
    () => {
      const result = copilotCliPreflight()

      assert.equal(result.ok, false)
      assert.deepEqual(result.missing_flags, ['--available-tools'])
    },
  )
})

test('resume failure and fresh fallback keep distinct live identities and explicit model failures', () => {
  const root = harnessRoot()
  const binary = fakeCopilot({ root })
  const live = {
    run_id: 'run-1',
    invocation_id: 'inv-1',
    role: 'stage',
    attempt: 1,
  }

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: binary,
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'wrong-model',
    },
    () => {
      const adapter = createCopilotAdapter({
        root,
        live,
        workspaceDir: root,
        stage: stage('read_only'),
        persona: 'reviewer',
        mapping: parsePersonaMapping('copilot:gpt-5.6-sol[provider=openai]'),
      })
      const failed = adapter.run('private resume directive', 'sess-previous')
      assert.equal(failed.ok, false)
      assert.match(failed.error ?? '', /reported model/u)
      const fresh = withEnv({ FAKE_MODEL: 'gpt-5.6-sol' }, () =>
        adapter.run('private full card'),
      )
      assert.equal(fresh.ok, true, fresh.error ?? '')
      assert.equal(
        fresh.argv.some((argument) => argument.startsWith('--resume=')),
        false,
      )
      const directory = resolveRunLayout(root, live.run_id).evidence(
        '',
      ).absolute
      const identities = readdirSync(directory)
        .filter((name) => name.endsWith('.live.json'))
        .map(
          (name) =>
            JSON.parse(
              readFileSync(path.join(directory, name), 'utf8'),
            ) as DelegationLiveIdentity,
        )
      assert.equal(identities.length, 2)
      assert.notEqual(identities[0]?.launch_id, identities[1]?.launch_id)
      const records = identities.map((identity) =>
        loadDelegationLiveRecord(root, identity),
      )
      const resumed = records.find((record) => record?.resumed_from_session_id)
      const fallback = records.find(
        (record) => !record?.resumed_from_session_id,
      )
      assert.equal(resumed?.resumed_from_session_id, 'sess-previous')
      assert.ok(resumed?.ended_at)
      assert.match(resumed?.error ?? '', /reported model/u)
      assert.equal(fallback?.error, undefined)
      assert.match(fallback?.requested_session_id ?? '', /^[0-9a-f-]{36}$/u)
      assert.equal(fallback?.session_id, fallback?.requested_session_id)
      assert.equal(resumed?.requested_session_id, 'sess-previous')
    },
  )
})

test(
  'operator revision automatically resumes Copilot and falls back to a fresh full card after failure',
  { timeout: 90_000 },
  async (context) => {
    const run = checkpoint('planning@created', {
      key: 'copilot-automatic-revision',
      fixture: (root) => {
        pinFixturePersonaModel(
          root,
          'planner',
          'copilot:gpt-5.6-sol[provider=openai]',
        )
        execFileSync('git', ['add', 'config.json'], { cwd: root })
        execFileSync('git', ['commit', '-qm', 'Configure Copilot planner'], {
          cwd: root,
        })
      },
    })
    const { root, runId } = run
    const binary = fakeCopilot({ revision: true, root })
    const server = createServer()
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const directory = resolveRunLayout(root, runId).evidence('').absolute
    const records = (): DelegationLiveRecord[] =>
      readdirSync(directory)
        .filter((name) => name.endsWith('.live.json'))
        .map(
          (name) =>
            JSON.parse(
              readFileSync(path.join(directory, name), 'utf8'),
            ) as DelegationLiveIdentity,
        )
        .map((identity) => {
          const record = loadDelegationLiveRecord(root, identity)
          assert.ok(record)
          return record
        })
    const dispatch = () => {
      const child = spawn(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `
      import {delegateInvocation} from ${JSON.stringify(new URL('../../src/lib/engine.js', import.meta.url).href)}
      process.stdout.write(JSON.stringify(delegateInvocation(${JSON.stringify(root)},${JSON.stringify(runId)}).execution))
    `,
        ],
        {
          env: {
            ...process.env,
            PANCREATOR_COPILOT_BIN: binary,
            OPENAI_API_KEY: FAKE_KEY,
            COPILOT_REVISION_PORT: String(address.port),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stdout = ''
      let progress = ''
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        progress += String(chunk)
      })
      const result = once(child, 'close').then(([code]) => {
        assert.equal(code, 0, progress)
        return JSON.parse(stdout) as ExternalDelegationRecord
      })
      const observe = async (label: string) => {
        const { session } = JSON.parse(
          readFileSync(
            path.join(path.dirname(binary), label + '.json'),
            'utf8',
          ),
        ) as { session: string }
        while (!progress.includes(`"sessionId":"${session}","exitCode"`)) {
          await Promise.race([
            once(child.stderr, 'data', { signal: context.signal }),
            result.then(() =>
              assert.fail('dispatcher returned before observation'),
            ),
          ])
        }
        const record = records().find(
          (item) => item.session_id === session && !item.ended_at,
        )
        assert.ok(record?.child_pid && processIsAlive(record.child_pid))
        assert.equal(record.requested_session_id, session)
        assert.equal(record.ended_at, undefined)
        const mutex = operationMutexPath(root, runId)
        assert.equal(Number(readFileSync(mutex, 'utf8').trim()), child.pid)
        assert.throws(
          () => withOperationMutex(mutex, () => assert.fail('mutex released')),
          /operation.*progress|busy|held|mutex/iu,
        )
        return record
      }
      return { child, result, observe, progress: () => progress }
    }
    let running: ReturnType<typeof dispatch> | undefined
    const sockets: Socket[] = []
    try {
      const first = prepareInvocation(root, runId)
      assert.ok(first.invocation)
      let connection = once(server, 'connection', { signal: context.signal })
      running = dispatch()
      const connected = async (pending: typeof connection) => {
        assert.ok(running)
        return Promise.race([
          pending,
          running.result.then(() =>
            assert.fail('dispatcher returned before the required handshake'),
          ),
        ])
      }
      sockets.push((await connected(connection))[0] as Socket)
      const initialLive = await running.observe('session-first')
      sockets.at(-1)?.write('release')
      const initial = await running.result
      assert.equal(initial.delegation_kind, 'fresh')
      assert.equal(initial.session_id, initialLive.requested_session_id)
      assert.match(initial.session_id ?? '', /^[0-9a-f-]{36}$/u)
      const output = makeOutput(
        root,
        first.invocation,
        stageBySlug(runWorkflow(root, first.state), 'plan'),
        'success',
        first.state,
      )
      writeJson(path.join(root, first.invocation.output.path), output)
      assert.equal(
        submitAsSupervisor(root, runId, first.invocation.output.path).record
          .outcome,
        'success',
      )
      assert.equal(getRunState(root, runId).status, 'awaiting_operator')
      decideRun(root, runId, 'revise', 'Tighten the rollout risks.')
      const revision = prepareInvocation(root, runId).invocation
      assert.ok(revision)
      connection = once(server, 'connection', { signal: context.signal })
      running = dispatch()
      sockets.push((await connected(connection))[0] as Socket)
      const resumed = await running.observe('session-resume')
      assert.equal(resumed.resumed_from_session_id, initial.session_id)
      assert.equal(resumed.session_id, initial.session_id)
      const input = (session: string) =>
        JSON.parse(
          readFileSync(
            path.join(path.dirname(binary), session + '.json'),
            'utf8',
          ),
        ) as { argv: string[]; prompt: string }
      assert.ok(
        input('session-resume').argv.includes(`--resume=${initial.session_id}`),
      )
      assert.equal(
        input('session-resume').argv.some((arg) =>
          arg.startsWith('--session-id='),
        ),
        false,
      )
      assert.match(
        input('session-resume').prompt,
        /Tighten the rollout risks\./u,
      )
      assert.match(
        input('session-resume').prompt,
        /# Operator revision directive/u,
      )
      connection = once(server, 'connection', { signal: context.signal })
      sockets.at(-1)?.write('release')
      sockets.push((await connected(connection))[0] as Socket)
      const fresh = await running.observe('session-fallback')
      for (const record of [resumed, fresh]) {
        assert.equal(record.invocation_id, revision.invocation_id)
        assert.equal(record.attempt, revision.attempt)
        assert.equal(record.role, 'stage')
      }

      assert.equal(fresh.resumed_from_session_id, undefined)
      assert.notEqual(fresh.requested_session_id, resumed.requested_session_id)
      assert.notEqual(fresh.launch_id, resumed.launch_id)
      assert.match(fresh.launch_id, /^[0-9a-f-]{36}$/u)
      assert.match(resumed.launch_id, /^[0-9a-f-]{36}$/u)
      assert.ok(loadDelegationLiveRecord(root, resumed)?.ended_at)
      assert.match(
        loadDelegationLiveRecord(root, resumed)?.error ?? '',
        /reported exit code 1/u,
      )
      assert.equal(
        input('session-fallback').argv.some((arg) =>
          arg.startsWith('--resume='),
        ),
        false,
      )
      assert.equal(
        input('session-fallback').prompt,
        readFileSync(
          resolveRunLayout(root, runId).invocation(
            revision.invocation_id,
            '.md',
          ).absolute,
          'utf8',
        ),
      )
      sockets.at(-1)?.write('release')
      const final = await running.result
      assert.equal(final.delegation_kind, 'resume_fallback')
      assert.equal(final.is_error, false)
      assert.equal(final.resumed_from_session_id, initial.session_id)
      assert.equal(final.session_id, fresh.requested_session_id)
      assert.equal(final.session_id, fresh.session_id)
      assert.equal(final.resume_attempt?.exit_code, 1)
      assert.equal(final.resume_attempt?.timed_out, false)
      assert.ok(final.resume_attempt)
      assert.ok(existsSync(path.join(root, final.resume_attempt.stderr_path)))
      assert.match(
        readFileSync(path.join(root, final.resume_attempt.stdout_path), 'utf8'),
        /"exitCode":1/u,
      )
      assert.equal(final.reported_model, 'gpt-5.6-sol')
      assert.equal(final.model_verification?.status, 'compared')
      assert.equal(
        getRunState(root, runId).external_executor_sessions?.plan?.session_id,
        fresh.session_id,
      )
      assert.equal(existsSync(operationMutexPath(root, runId)), false)
      assert.equal(new Set(records().map((record) => record.launch_id)).size, 3)

      for (const record of records()) {
        assert.ok(record.ended_at)
        assert.equal(
          record.invocation_id === first.invocation.invocation_id ||
            record.invocation_id === revision.invocation_id,
          true,
        )
        assert.equal(processIsAlive(record.child_pid ?? 0), false)
        const events = readFileSync(
          delegationLivePaths(root, record).events,
          'utf8',
        )
        assert.equal((events.match(/"kind":"completion"/gu) ?? []).length, 1)
        assert.ok(!events.includes(FAKE_KEY))
      }
      assert.equal(
        (running.progress().match(/"type":"result"/gu) ?? []).length,
        2,
      )
      assert.ok(!running.progress().includes(FAKE_KEY))
    } finally {
      for (const socket of sockets) {
        socket.destroy()
      }

      running?.child.kill('SIGTERM')
      await running?.result.catch(() => {})
      server.close()
      await once(server, 'close')
    }
  },
)

test('the adapter pipes the card on stdin, trusts the workspace, and redacts the key', () => {
  const root = harnessRoot()
  const binary = fakeCopilot({ root })
  const binDir = path.dirname(binary)

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: binary,
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-5.6-sol',
      CURSOR_CONVERSATION_ID: 'supervisor-conversation',
    },
    () => {
      const adapter = createCopilotAdapter({
        root,
        workspaceDir: root,
        stage: stage('read_only'),
        persona: 'reviewer',
        mapping: parsePersonaMapping(
          'copilot:gpt-5.6-sol[provider=openai,effort=high]',
        ),
      })
      const result = adapter.run('# Card body', 'sess-0')

      assert.equal(result.ok, true, result.error ?? 'adapter failed')
      assert.equal(result.session_id, 'sess-0')
      assert.equal(result.reported_model, 'gpt-5.6-sol')
      assert.deepEqual(result.model_verification, {
        status: 'compared',
        expected_model: 'gpt-5.6-sol',
      })
      assert.equal(
        readFileSync(path.join(binDir, 'stdin.txt'), 'utf8'),
        '# Card body',
      )
      assert.deepEqual(
        readFileSync(path.join(binDir, 'env.txt'), 'utf8')
          .split('\n')
          .slice(0, 4),
        ['true', 'openai', 'copilot-cli', 'unset'],
      )

      const argv = readFileSync(path.join(binDir, 'argv.txt'), 'utf8')

      assert.match(argv, /^--reasoning-effort\nhigh$/mu)
      assert.match(argv, /^--resume=sess-0$/mu)
      assert.ok(!argv.includes('Card body'))
      assert.ok(!argv.includes(FAKE_KEY))
      assert.ok(!result.argv.join(' ').includes(FAKE_KEY))
      assert.ok(!result.stdout.includes(FAKE_KEY))
      assert.match(result.stdout, /done \[REDACTED\]/u)
    },
  )
})

test('the adapter fails when the stream names another model', () => {
  const root = harnessRoot()

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: fakeCopilot({ root }),
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-6-luna',
    },
    () => {
      const result = createCopilotAdapter({
        root,
        workspaceDir: root,
        stage: stage('source_allowed'),
        persona: 'coder',
        mapping: parsePersonaMapping('copilot:gpt-5.6-sol[provider=openai]'),
      }).run('# Card')

      assert.equal(result.ok, false)
      assert.equal(result.is_error, true)
      assert.match(result.error ?? '', /reported model 'gpt-6-luna'/u)
    },
  )
})

test('a worktree worker launches with the projected hooks and its persona agent beside it', () => {
  const root = harnessRoot()
  const workspace = createTestTempDirectory('copilot-worktree-')
  const binary = fakeCopilot({ root })

  mkdirSync(path.join(root, '.github', 'hooks'), { recursive: true })
  mkdirSync(path.join(root, '.github', 'agents'), { recursive: true })
  writeFileSync(
    path.join(root, '.github/hooks/pan-hooks.json'),
    JSON.stringify({
      version: 1,
      hooks: {
        preToolUse: [
          {
            type: 'command',
            bash: 'bin/pan-hook-adapter --fail-closed preToolUse pan-hook-deny-await-shell',
          },
        ],
      },
    }),
  )
  writeFileSync(path.join(root, '.github/agents/pan-coder.agent.md'), '---\n')

  withEnv(
    {
      PANCREATOR_COPILOT_BIN: binary,
      OPENAI_API_KEY: FAKE_KEY,
      FAKE_MODEL: 'gpt-5.6-sol',
    },
    () => {
      const result = createCopilotAdapter({
        root,
        workspaceDir: workspace,
        stage: stage('source_allowed'),
        persona: 'coder',
        mapping: parsePersonaMapping('copilot:gpt-5.6-sol[provider=openai]'),
      }).run('# Card')

      assert.equal(result.ok, true, result.error ?? 'adapter failed')
    },
  )

  const hooks = JSON.parse(
    readFileSync(path.join(workspace, '.github/hooks/pan-hooks.json'), 'utf8'),
  ) as { hooks: { preToolUse: { bash: string }[] } }
  const argv = readFileSync(path.join(path.dirname(binary), 'argv.txt'), 'utf8')

  assert.equal(
    hooks.hooks.preToolUse[0]?.bash,
    `${path.resolve(root)}/bin/pan-hook-adapter --fail-closed preToolUse pan-hook-deny-await-shell`,
  )
  assert.equal(
    readFileSync(
      path.join(workspace, '.github/agents/pan-coder.agent.md'),
      'utf8',
    ),
    '---\n',
  )
  assert.match(argv, /^--agent\npan-coder$/mu)
  assert.ok(argv.includes(`--add-dir\n${path.resolve(root)}\n`))
})
