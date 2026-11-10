import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import test from 'node:test'

import {
  resolveRelayPromptContext,
  startReminderRelay,
} from '../../src/lib/governance/prompt-context/relay.js'
import {
  isRecord,
  readJson,
  readText,
  writeJsonAtomic,
} from '../../src/lib/io.js'
import { createFixture } from '../fixture-template.js'

const SSE =
  'data: {"type":"response.completed","response":{"id":"synthetic-response"}}\n\ndata: [DONE]\n\n'

async function hook(
  root: string,
  session: string,
  prompt = '',
): Promise<string> {
  const payload = JSON.stringify({
    conversation_id: session,
    hook_event_name: prompt ? 'beforeSubmitPrompt' : 'postToolUse',
    host: 'vscode',
    prompt,
  })
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile(
      process.execPath,
      [
        path.join(process.cwd(), 'dist/src/cli.js'),
        'governance',
        'prompt-context',
      ],
      {
        cwd: root,
        env: { ...process.env, PANCREATOR_ROOT: root },
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
        } else {
          resolve(stdout)
        }
      },
    )
    child.stdin?.end(payload)
  })
  const value: unknown = JSON.parse(output)
  assert.ok(isRecord(value) && typeof value.additional_context === 'string')
  return value.additional_context
}

test(
  'happy_path: native hook CLI through loopback OpenAI relay removes copies on the actual wire and preserves SSE',
  { timeout: 30_000 },
  async (t) => {
    const root = createFixture()
    const received: Array<Record<string, unknown>> = []
    const upstream = createServer((request, response) => {
      let body = ''
      request.setEncoding('utf8')
      request.on('data', (chunk: string) => {
        body += chunk
      })
      request.on('end', () => {
        const value: unknown = JSON.parse(body)
        assert.ok(isRecord(value))
        received.push(value)
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'x-request-id': 'synthetic-request',
        })
        response.write(SSE.slice(0, 20))
        response.end(SSE.slice(20))
      })
    })
    await new Promise<void>((resolve) => {
      upstream.listen(0, '127.0.0.1', resolve)
    })
    const address = upstream.address()
    assert.ok(address && typeof address !== 'string')
    const relay = await startReminderRelay(root, {
      upstream: `http://127.0.0.1:${address.port}`,
    })

    try {
      const health = await fetch(`${relay.url}/pan/health`)
      assert.equal(health.status, 200)
      const first = await hook(root, 'parent', '/pan-pair')
      const again = await hook(root, 'parent')
      assert.equal(first, again)
      assert.match(first, /<pancreator-reminder/u)
      const send = async (input: unknown[]) => {
        const body = {
          model: 'synthetic-openai',
          input,
          tools: [{ type: 'function', name: 'read_fixture', parameters: {} }],
          stream: true,
          store: false,
        }
        const response = await fetch(`${relay.url}/v1/responses`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer synthetic-smoke',
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        })
        assert.equal(response.status, 200)
        assert.equal(response.headers.get('x-request-id'), 'synthetic-request')
        assert.equal(await response.text(), SSE)
        return body
      }
      await send([{ role: 'developer', content: first }])
      const original = await send(
        [first, again, again].map((text) => ({
          role: 'developer',
          content: [{ type: 'input_text', text }],
        })),
      )
      const forwarded = received[1]
      assert.ok(forwarded)
      assert.deepEqual(forwarded.tools, original.tools)
      assert.equal(forwarded.store, false)
      assert.equal(forwarded.stream, true)
      const wire = JSON.stringify(forwarded)
      const before = Buffer.byteLength(JSON.stringify(original))
      const after = Buffer.byteLength(wire)
      assert.ok(after < before)
      assert.equal(wire.split('kind=\\"full\\"').length - 1, 1)
      assert.equal(wire.split('kind=\\"cue\\"').length - 1, 2)
      t.diagnostic(
        `Wire smoke: ${before} bytes before, ${after} after; ${before - after} bytes saved.`,
      )

      assert.ok(Array.isArray(forwarded.input))
      const cue = forwarded.input[1]
      assert.ok(isRecord(cue))
      await send([cue])
      assert.ok(
        JSON.stringify(received[2]).includes('Pancreator governance reminder'),
      )
      const child = await hook(root, 'child', '/pan-pair')
      await send(
        [first, child].map((content) => ({ role: 'developer', content })),
      )
      assert.equal(
        JSON.stringify(received[3]).includes('kind=\\"cue\\"'),
        false,
      )

      const audit = readText(relay.audit_path)
      assert.match(audit, /"cues":2/u)
      assert.equal(audit.includes('synthetic-smoke'), false)
      assert.equal(audit.includes('Pancreator governance reminder'), false)
    } finally {
      await relay.close()
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve()
          }
        })
      })
    }

    assert.equal(
      existsSync(path.join(root, 'runtime/reminder-relay.json')),
      false,
    )
    const fallback = await hook(root, 'parent')
    assert.equal(fallback.includes('<pancreator-reminder'), false)
    assert.ok(fallback.includes('Pancreator governance reminder'))
  },
)

test(
  'probable_edge_case: installed bootstrap cards retain relay framing',
  { timeout: 30_000 },
  async (t) => {
    for (const mode of ['embedded', 'detached'] as const) {
      await t.test(mode, async () => {
        const root = createFixture()
        const configPath = path.join(root, 'config.json')
        const config = readJson(configPath)
        assert.ok(isRecord(config))
        config.installation_mode = mode

        if (mode === 'detached') {
          config.workspace_root = path.join(root, 'target')
        }

        writeJsonAtomic(configPath, config)
        copyFileSync(
          path.join(root, 'library', 'templates', `${mode}-AGENTS.md`),
          path.join(root, 'AGENTS.md'),
        )

        const relay = await startReminderRelay(root)

        try {
          const first = await hook(root, 'installed-parent', '/pan-pair')
          assert.match(first, /<pancreator-reminder/u)
          assert.equal(await hook(root, 'installed-parent'), first)
        } finally {
          await relay.close()
        }
      })
    }
  },
)

test(
  'probable_edge_case: relay CLI starts on loopback and removes only its discovery record on shutdown',
  { timeout: 20_000 },
  async () => {
    const root = createFixture()
    const child = spawn(
      process.execPath,
      [
        path.join(process.cwd(), 'dist/src/cli.js'),
        'governance',
        'reminder-relay',
        '--port',
        '0',
      ],
      {
        cwd: root,
        env: { ...process.env, PANCREATOR_ROOT: root },
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      },
    )
    const exited = once(child, 'exit')

    try {
      let output = ''
      let url: string | undefined

      for await (const chunk of child.stdout) {
        output += String(chunk)
        let value: unknown

        try {
          value = JSON.parse(output)
        } catch {
          continue
        }

        if (isRecord(value) && typeof value.url === 'string') {
          url = value.url
          break
        }
      }

      assert.ok(url, output)
      assert.ok(url.endsWith('/v1'), output)
      assert.equal((await fetch(`${url.slice(0, -3)}/pan/health`)).status, 200)
    } finally {
      child.kill('SIGTERM')
      const [code] = await exited
      assert.equal(code, 0)
    }

    assert.equal(
      existsSync(path.join(root, 'runtime/reminder-relay.json')),
      false,
    )
  },
)

test(
  'critical_unhappy_path: relay errors are visible and stale discovery keeps full native delivery',
  { timeout: 15_000 },
  async () => {
    const root = createFixture()
    const relay = await startReminderRelay(root, {
      upstream: 'http://127.0.0.1:1',
      mode: 'full',
    })

    try {
      await assert.rejects(startReminderRelay(root), {
        code: 'REMINDER_RELAY_RUNNING',
      })
      const post = (
        route: string,
        body: string,
        headers: Record<string, string> = {},
      ) =>
        fetch(`${relay.url}${route}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body,
          signal: AbortSignal.timeout(5000),
        })
      assert.equal((await post('/v1/responses', '{}')).status, 401)
      assert.equal(
        (
          await post('/v1/responses', '{}', {
            origin: 'https://untrusted.invalid',
          })
        ).status,
        403,
      )
      assert.equal((await post('/other', '{}')).status, 404)
      assert.equal((await post('/pan/reminder', '{}')).status, 422)
      assert.equal(
        (
          await post('/v1/responses', '{', {
            authorization: 'Bearer synthetic',
          })
        ).status,
        400,
      )
      const unavailable = await post('/v1/responses', '{}', {
        authorization: 'Bearer synthetic',
      })
      assert.equal(unavailable.status, 502)
      assert.match(await unavailable.text(), /OPENAI_UPSTREAM_UNAVAILABLE/u)
    } finally {
      await relay.close()
    }

    writeFileSync(path.join(root, 'runtime/reminder-relay.json'), '{broken')
    const fallback = await resolveRelayPromptContext(
      root,
      JSON.stringify({
        conversation_id: 'fallback',
        prompt: '/pan-pair',
        hook_event_name: 'beforeSubmitPrompt',
      }),
    )
    assert.ok(
      fallback.additional_context?.includes('Pancreator governance reminder'),
    )
    await assert.rejects(
      startReminderRelay(root, { upstream: 'https://untrusted.invalid' }),
      { code: 'INVALID_REMINDER_RELAY' },
    )
  },
)
