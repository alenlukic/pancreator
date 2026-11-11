/** Opt-in loopback OpenAI transport; native hooks continue to deliver full text. */

import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import path from 'node:path'

import { PanError } from '../../errors.js'
import {
  appendJsonLine,
  canonicalize,
  fileExists,
  isRecord,
  readJson,
  readText,
  sha256,
  withOperationMutex,
  writeJsonAtomic,
} from '../../io.js'
import type { CanonicalReminderOptions } from './canonical.js'
import { applyReminderCache } from './cache.js'
import { PromptCacheUsageObserver } from './cache-usage.js'
import {
  PromptCacheComparisons,
  type CacheComparison,
} from './cache-diagnostics.js'
import { ReminderRelayPackets, unwrapRelayHookText } from './relay-packets.js'
import { resolvePromptContext } from './routing.js'

const RECEIPT = 'runtime/reminder-relay.json'
const LIMIT = 8 * 1024 * 1024

function isRelayOwnerAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return isRecord(error) && error.code === 'EPERM'
  }
}

function parseScope(value: unknown): CanonicalReminderOptions {
  if (
    !isRecord(value) ||
    !['host', 'provider', 'session', 'role'].every(
      (key) => typeof value[key] === 'string',
    )
  ) {
    throw new PanError('A canonical reminder scope is required.', {
      code: 'INVALID_CANONICAL_REMINDER',
    })
  }

  const scope: CanonicalReminderOptions = {
    host: String(value.host),
    provider: String(value.provider),
    session: String(value.session),
    role: String(value.role),
  }

  for (const key of ['card', 'invocation'] as const) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string') {
        throw new PanError('Contract paths must be strings.', {
          code: 'INVALID_CANONICAL_REMINDER',
        })
      }
      scope[key] = value[key]
    }
  }

  return scope
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length

    if (bytes > LIMIT) {
      throw new PanError('Request exceeds the relay byte limit.', {
        code: 'REQUEST_TOO_LARGE',
      })
    }
    chunks.push(buffer)
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/**
 * Serve OpenAI Responses and Chat Completions on loopback, preserving SSE bytes.
 * Credentials come only from each inbound request and are never stored or logged.
 * The optional loopback upstream exists for a deterministic, unpaid smoke test.
 */
export async function startReminderRelay(
  root: string,
  options: {
    port?: number
    mode?: 'guarded' | 'full'
    cache?: boolean
    upstream?: string
    ownerPid?: number
  } = {},
) {
  const upstream = new URL(options.upstream ?? 'https://api.openai.com')

  if (
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    upstream.pathname !== '/' ||
    !(
      (upstream.protocol === 'https:' && upstream.host === 'api.openai.com') ||
      (upstream.protocol === 'http:' && upstream.hostname === '127.0.0.1')
    )
  ) {
    throw new PanError(
      'Relay upstream must be OpenAI HTTPS or an explicit loopback test server.',
      { code: 'INVALID_REMINDER_RELAY' },
    )
  }

  const port = options.port ?? 0

  if (
    !Number.isInteger(port) ||
    port < 0 ||
    port > 65535 ||
    (options.mode !== undefined && !['guarded', 'full'].includes(options.mode))
  ) {
    throw new PanError('Invalid relay port or delivery mode.', {
      code: 'INVALID_REMINDER_RELAY',
    })
  }

  if (options.ownerPid !== undefined && !isRelayOwnerAlive(options.ownerPid)) {
    throw new PanError('Relay owner must name a running process.', {
      code: 'INVALID_REMINDER_RELAY',
    })
  }

  const receiptPath = path.join(root, RECEIPT)
  const initialReceipt = fileExists(receiptPath) ? readText(receiptPath) : null

  if (fileExists(receiptPath)) {
    let receipt: unknown

    try {
      receipt = readJson(receiptPath)
    } catch {
      receipt = null
    }

    if (
      isRecord(receipt) &&
      typeof receipt.url === 'string' &&
      /^http:\/\/127\.0\.0\.1:\d+$/u.test(receipt.url)
    ) {
      try {
        const alive = await fetch(`${receipt.url}/pan/health`, {
          signal: AbortSignal.timeout(1000),
        })
        const health: unknown = await alive.json()

        if (isRecord(health) && health.workspace === canonicalize(root)) {
          throw new PanError(
            'A reminder relay already serves this workspace.',
            { code: 'REMINDER_RELAY_RUNNING' },
          )
        }
      } catch (error) {
        if (error instanceof PanError) {
          throw error
        }
        // A dead relay's public discovery file is replaced below.
      }
    }
  }

  const relayId = randomUUID()
  const owners = new Set(
    options.ownerPid === undefined ? [] : [options.ownerPid],
  )
  const packets = new ReminderRelayPackets(root)
  const comparisons = new PromptCacheComparisons()
  const cacheValidation = {
    comparisons: 0,
    matched: 0,
    misses: 0,
    unavailable: 0,
    usage_responses: 0,
    unavailable_usage_responses: 0,
    input_tokens: 0,
    cached_tokens: 0,
  }
  const auditPath = path.join(
    root,
    'runtime/logs/reminders',
    `${relayId}.jsonl`,
  )
  let url = ''

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (request.headers.origin || request.headers.host !== new URL(url).host) {
      sendJson(response, 403, { error: { code: 'LOCAL_REQUEST_REQUIRED' } })
      return
    }

    const route = new URL(request.url ?? '/', url)

    if (request.method === 'GET' && route.pathname === '/pan/health') {
      sendJson(response, 200, {
        schema_version: 1,
        workspace: canonicalize(root),
        relay_id: relayId,
        managed: options.ownerPid !== undefined,
        mode: options.mode ?? 'guarded',
        prompt_cache: options.cache !== false,
        cache_validation: {
          ...cacheValidation,
          cached_input_share:
            cacheValidation.input_tokens > 0
              ? cacheValidation.cached_tokens / cacheValidation.input_tokens
              : null,
        },
      })
      return
    }

    if (request.method === 'POST' && route.pathname === '/pan/lifecycle') {
      const input = await readBody(request)

      if (
        !isRecord(input) ||
        input.relay_id !== relayId ||
        !['start', 'stop'].includes(String(input.action)) ||
        (input.owner_pid !== undefined &&
          (typeof input.owner_pid !== 'number' ||
            !Number.isSafeInteger(input.owner_pid) ||
            input.owner_pid <= 0))
      ) {
        sendJson(response, 403, { error: { code: 'INVALID_RELAY_LIFECYCLE' } })
        return
      }

      const ownerPid = input.owner_pid

      if (input.action === 'start' && typeof ownerPid === 'number') {
        if (!isRelayOwnerAlive(ownerPid)) {
          sendJson(response, 422, { error: { code: 'INVALID_RELAY_OWNER' } })
          return
        }
        owners.add(ownerPid)
      } else if (input.action === 'stop' && typeof ownerPid === 'number') {
        owners.delete(ownerPid)
      }

      const shouldClose =
        input.action === 'stop' &&
        (ownerPid === undefined ||
          (options.ownerPid !== undefined && owners.size === 0))
      response.once('finish', () => {
        if (shouldClose) {
          void close()
        }
      })
      sendJson(response, 200, {
        status: shouldClose ? 'stopped' : 'running',
        url,
      })
      return
    }

    if (request.method === 'POST' && route.pathname === '/pan/reminder') {
      const input = await readBody(request)

      if (!isRecord(input) || typeof input.body !== 'string') {
        throw new PanError('Expected a full hook reminder.', {
          code: 'INVALID_REMINDER_REQUEST',
        })
      }

      const scope = parseScope(input.scope)
      const body = packets.issue(scope, input.body)
      appendJsonLine(auditPath, {
        event: 'full_hook',
        at: new Date().toISOString(),
        scope_sha256: sha256(scope),
        framed: body !== input.body,
      })
      sendJson(response, 200, { body })
      return
    }

    const isGeneration =
      request.method === 'POST' &&
      ['/v1/responses', '/v1/chat/completions'].includes(route.pathname)
    const isModels = request.method === 'GET' && route.pathname === '/v1/models'

    if (!isGeneration && !isModels) {
      sendJson(response, 404, { error: { code: 'UNSUPPORTED_RELAY_ROUTE' } })
      return
    }

    if (
      typeof request.headers.authorization !== 'string' ||
      !request.headers.authorization.startsWith('Bearer ')
    ) {
      sendJson(response, 401, { error: { code: 'BEARER_REQUIRED' } })
      return
    }

    let body: string | undefined
    let comparison: CacheComparison | undefined
    const requestId = randomUUID()
    const started = performance.now()

    if (isGeneration) {
      const transformed = packets.transform(
        await readBody(request),
        options.mode,
      )
      const cached = applyReminderCache(
        transformed.request,
        route.pathname,
        options.cache !== false,
        transformed.foundations,
      )
      if (cached.evidence.request_mode === 'implicit') {
        comparison = comparisons.prepare(
          cached.request,
          sha256({
            authorization: request.headers.authorization,
            organization: request.headers['openai-organization'],
            project: request.headers['openai-project'],
          }),
        )
      }
      body = JSON.stringify(cached.request)
      appendJsonLine(auditPath, {
        event: 'request',
        at: new Date().toISOString(),
        request_id: requestId,
        ...transformed.stats,
        prompt_cache: cached.evidence,
        comparison_response_id: comparison?.comparison_response_id,
      })
    }

    const headers: Record<string, string> = {
      authorization: request.headers.authorization,
      accept: request.headers.accept ?? 'application/json',
    }

    for (const name of ['openai-organization', 'openai-project']) {
      const value = request.headers[name]

      if (typeof value === 'string') {
        headers[name] = value
      }
    }

    if (body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(body))
    }

    const transport =
      upstream.protocol === 'https:' ? httpsRequest : httpRequest
    const outgoing = transport(
      new URL(`${route.pathname}${route.search}`, upstream),
      { method: request.method, headers },
      (incoming) => {
        const responseHeaders: Record<string, string> = {}

        for (const name of [
          'content-type',
          'cache-control',
          'content-encoding',
          'x-request-id',
          'retry-after',
        ]) {
          const value = incoming.headers[name]

          if (typeof value === 'string') {
            responseHeaders[name] = value
          }
        }

        response.writeHead(incoming.statusCode ?? 502, responseHeaders)

        if (route.pathname === '/v1/responses') {
          const observer = new PromptCacheUsageObserver(
            String(incoming.headers['content-type']).includes(
              'text/event-stream',
            ),
            (usage, diagnostics, completedResponseId) => {
              try {
                if (comparison && incoming.statusCode === 200) {
                  comparisons.complete(comparison, completedResponseId)
                }
                if (comparison?.comparison_response_id) {
                  cacheValidation.comparisons++

                  if (diagnostics?.type === 'cache_miss') {
                    cacheValidation.misses++
                  } else if (diagnostics?.type === 'cache_hit') {
                    cacheValidation.matched++
                  } else {
                    cacheValidation.unavailable++
                  }
                }

                if (
                  usage?.input_tokens !== undefined &&
                  usage.cached_tokens !== undefined
                ) {
                  cacheValidation.usage_responses++
                  cacheValidation.input_tokens += usage.input_tokens
                  cacheValidation.cached_tokens += usage.cached_tokens
                } else {
                  cacheValidation.unavailable_usage_responses++
                }
                appendJsonLine(auditPath, {
                  event: 'cache_usage',
                  at: new Date().toISOString(),
                  request_id: requestId,
                  http_status: incoming.statusCode ?? 502,
                  latency_ms: Math.round(performance.now() - started),
                  status: usage ? 'observed' : 'unavailable',
                  cache_hit:
                    usage?.cached_tokens === undefined
                      ? 'unverified'
                      : usage.cached_tokens > 0,
                  ...usage,
                  comparison_response_id: comparison?.comparison_response_id,
                  prompt_cache_diagnostics:
                    diagnostics ??
                    (comparison?.comparison_response_id
                      ? { type: 'unavailable' }
                      : undefined),
                  cache_validation:
                    diagnostics?.type === 'cache_miss'
                      ? 'miss'
                      : diagnostics?.type === 'cache_hit'
                        ? 'matched'
                        : comparison?.comparison_response_id
                          ? 'unavailable'
                          : 'no_baseline',
                })
              } catch {
                incoming.destroy(new Error('REMINDER_AUDIT_WRITE_FAILED'))
                response.destroy()
              }
            },
          )
          incoming.on('data', (chunk: Buffer) => {
            observer.write(chunk)
          })
          incoming.once('close', () => {
            observer.finish()
          })
        }

        incoming.on('error', () => {
          response.destroy()
        })
        incoming.pipe(response)
      },
    )
    outgoing.setTimeout(120_000, () => {
      outgoing.destroy(new Error('Upstream timed out'))
    })
    outgoing.on('error', () => {
      if (!response.headersSent) {
        sendJson(response, 502, {
          error: { code: 'OPENAI_UPSTREAM_UNAVAILABLE' },
        })
      } else {
        response.destroy()
      }
    })
    response.on('close', () => {
      outgoing.destroy()
    })
    outgoing.end(body)
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) {
        sendJson(response, error instanceof PanError ? 422 : 400, {
          error: {
            code:
              error instanceof PanError ? error.code : 'INVALID_RELAY_REQUEST',
          },
        })
      } else {
        response.destroy()
      }
    })
  })
  server.requestTimeout = 30_000
  server.headersTimeout = 10_000

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()

  if (!address || typeof address === 'string') {
    server.close()
    throw new PanError('Relay did not bind a TCP address.', {
      code: 'INVALID_REMINDER_RELAY',
    })
  }
  url = `http://127.0.0.1:${address.port}`

  let ownerMonitor: ReturnType<typeof setInterval> | undefined
  let closing = false
  const closed = new Promise<void>((resolve) => {
    server.once('close', resolve)
  })
  const close = async (): Promise<void> => {
    if (closing) {
      return closed
    }
    closing = true
    clearInterval(ownerMonitor)

    try {
      withOperationMutex(`${receiptPath}.mutex`, () => {
        if (fileExists(receiptPath)) {
          let receipt: unknown

          try {
            receipt = readJson(receiptPath)
          } catch {
            return // A foreign or corrupt discovery record is not ours to remove.
          }

          if (isRecord(receipt) && receipt.relay_id === relayId) {
            unlinkSync(receiptPath)
          }
        }
      })
    } finally {
      server.close()
      server.closeAllConnections()
      await closed
    }
  }

  try {
    withOperationMutex(`${receiptPath}.mutex`, () => {
      const currentReceipt = fileExists(receiptPath)
        ? readText(receiptPath)
        : null

      if (currentReceipt !== initialReceipt) {
        throw new PanError(
          'Another relay claimed this workspace during startup.',
          { code: 'REMINDER_RELAY_RUNNING' },
        )
      }

      writeJsonAtomic(receiptPath, {
        schema_version: 1,
        relay_id: relayId,
        workspace: canonicalize(root),
        url,
        pid: process.pid,
      })
    })
  } catch (error) {
    await close()
    throw error
  }

  if (options.ownerPid !== undefined) {
    ownerMonitor = setInterval(() => {
      for (const pid of owners) {
        if (!isRelayOwnerAlive(pid)) {
          owners.delete(pid)
        }
      }

      if (owners.size === 0) {
        void close()
      }
    }, 1000)
    ownerMonitor.unref()
  }

  return { url, audit_path: auditPath, closed, close }
}

/** Resolve native context once, with full-text fallback if the opt-in relay fails. */
export async function resolveRelayPromptContext(
  root: string,
  payloadText: string,
) {
  let scope: CanonicalReminderOptions | undefined
  const response = resolvePromptContext(
    root,
    payloadText,
    new Date(),
    (resolved) => {
      scope = resolved
    },
  )
  const receiptPath = path.join(root, RECEIPT)

  if (!scope || !response.additional_context || !fileExists(receiptPath)) {
    return response
  }

  try {
    const receipt = readJson(receiptPath)

    if (
      !isRecord(receipt) ||
      receipt.workspace !== canonicalize(root) ||
      typeof receipt.url !== 'string' ||
      !/^http:\/\/127\.0\.0\.1:\d+$/u.test(receipt.url)
    ) {
      return response
    }

    const result = await fetch(`${receipt.url}/pan/reminder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope, body: response.additional_context }),
      signal: AbortSignal.timeout(1000),
    })
    const value: unknown = await result.json()

    if (
      result.ok &&
      isRecord(value) &&
      typeof value.body === 'string' &&
      unwrapRelayHookText(value.body) === response.additional_context
    ) {
      return { ...response, additional_context: value.body }
    }
  } catch {
    // The full native result was already rendered; no clause receipt is retried.
  }

  return response
}
