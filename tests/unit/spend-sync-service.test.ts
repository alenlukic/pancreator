/**
 * Unit tests for the Vercel service handlers (AC-9).
 * Tests run the handlers directly with injected deps — no Blob store required.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

// handlers.js is a raw ESM file, not compiled — import from the source tree.
const HANDLERS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../services/spend-sync/lib/handlers.js',
)
const BLOB_DEPS_PATH = path.join(path.dirname(HANDLERS_PATH), 'blob-deps.js')

interface HandlersModule {
  handleUpload: (request: Request, deps: unknown) => Promise<Response>
  handleList: (request: Request, deps: unknown) => Promise<Response>
}

let handlers: HandlersModule

// Dynamic import so the test can run without @vercel/blob in the main workspace.
async function loadHandlers(): Promise<HandlersModule> {
  if (!handlers) {
    handlers = (await import(HANDLERS_PATH)) as HandlersModule
  }

  return handlers
}

function makeRequest(method: string, body?: unknown): Request {
  const init: RequestInit = { method }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer correct-token',
    }
  } else {
    init.headers = { Authorization: 'Bearer correct-token' }
  }

  return new Request('http://localhost/api/snapshots/upload', init)
}

function makeRequestWithAuth(
  method: string,
  auth: string,
  body?: unknown,
): Request {
  const init: RequestInit = { method, headers: { Authorization: auth } }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request('http://localhost/api/snapshots/upload', init)
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000'

const validDepsUpload = {
  token: 'correct-token',
  async presignPut(pathname: string) {
    return `http://127.0.0.1:9999/upload/${encodeURIComponent(pathname)}`
  },
}

const validDepsList = {
  token: 'correct-token',
  async list(prefix: string) {
    return [
      {
        pathname: `${prefix}${VALID_UUID}.json.gz`,
        uploadedAt: '2026-09-25T00:00:00.000Z',
        size: 1024,
      },
    ]
  },
  async presignGet(pathname: string) {
    return `http://127.0.0.1:9999/download/${encodeURIComponent(pathname)}`
  },
}

test('upload returns 401 for a missing bearer token', async () => {
  const { handleUpload } = await loadHandlers()
  const request = new Request('http://localhost/api/snapshots/upload', {
    method: 'POST',
    body: JSON.stringify({ instance_id: VALID_UUID }),
    headers: { 'Content-Type': 'application/json' },
  })

  const response = await handleUpload(request, validDepsUpload)

  assert.equal(response.status, 401)
})

test('upload returns 401 for a wrong bearer token', async () => {
  const { handleUpload } = await loadHandlers()
  const request = makeRequestWithAuth('POST', 'Bearer wrong-token', {
    instance_id: VALID_UUID,
  })
  const response = await handleUpload(request, validDepsUpload)

  assert.equal(response.status, 401)
})

test('upload returns 405 for a wrong method', async () => {
  const { handleUpload } = await loadHandlers()
  const request = makeRequestWithAuth('GET', 'Bearer correct-token')
  const response = await handleUpload(request, validDepsUpload)

  assert.equal(response.status, 405)
})

test('upload returns 400 for a non-UUID instance_id', async () => {
  const { handleUpload } = await loadHandlers()

  for (const instanceId of ['not-a-uuid', VALID_UUID.toUpperCase()]) {
    const request = makeRequest('POST', { instance_id: instanceId })
    const response = await handleUpload(request, validDepsUpload)

    assert.equal(response.status, 400, instanceId)
  }
})

test('the Blob wiring returns private presigned URLs, bypasses the read cache, and pages through the list', async () => {
  const { createBlobDeps } = (await import(BLOB_DEPS_PATH)) as {
    createBlobDeps: (
      blob: unknown,
      env: Record<string, string | undefined>,
    ) => {
      token: string | undefined
      presignPut: (pathname: string) => Promise<string>
      presignGet: (pathname: string) => Promise<string>
      list: (prefix: string) => Promise<unknown[]>
    }
  }
  const calls: Array<[string, unknown]> = []
  const blob = {
    async issueSignedToken(options: unknown) {
      calls.push(['issueSignedToken', options])

      return { delegationToken: 'd', clientSigningToken: 'c', validUntil: 1 }
    },
    async presignUrl(token: unknown, options: { operation: string }) {
      calls.push(['presignUrl', { token, ...options }])

      return { presignedUrl: `https://store.example/${options.operation}` }
    },
    async list(options: { cursor?: string }) {
      calls.push(['list', options])

      return options.cursor === undefined
        ? { blobs: [{ pathname: 'a' }], hasMore: true, cursor: 'next' }
        : { blobs: [{ pathname: 'b' }], hasMore: false }
    },
  }
  const deps = createBlobDeps(blob, { PAN_SPEND_SYNC_TOKEN: 'secret' })
  const pathname = `spend/instances/${VALID_UUID}.json.gz`

  assert.equal(deps.token, 'secret')
  assert.equal(await deps.presignPut(pathname), 'https://store.example/put')
  assert.equal(await deps.presignGet(pathname), 'https://store.example/get')
  assert.deepEqual(await deps.list('spend/instances/'), [
    { pathname: 'a' },
    { pathname: 'b' },
  ])

  const [putToken, putUrl, getToken, getUrl] = calls.map(
    ([, options]) => options as Record<string, unknown>,
  )

  assert.deepEqual(putToken?.operations, ['put'])
  assert.equal(putToken?.pathname, pathname)
  assert.equal(putUrl?.operation, 'put')
  assert.equal(putUrl?.access, 'private')
  assert.equal(putUrl?.allowOverwrite, true)
  assert.deepEqual(getToken?.operations, ['get'])
  assert.equal(getUrl?.access, 'private')
  assert.equal(getUrl?.useCache, false)
  assert.ok(
    (getUrl?.validUntil as number) <= Date.now() + 10 * 60 * 1000,
    'Signed URLs expire within 10 minutes',
  )
  assert.deepEqual(
    calls.filter(([name]) => name === 'list').map(([, options]) => options),
    [
      { prefix: 'spend/instances/' },
      { prefix: 'spend/instances/', cursor: 'next' },
    ],
  )
})

test('upload returns 500 when the server token is unset', async () => {
  const { handleUpload } = await loadHandlers()
  const request = makeRequest('POST', { instance_id: VALID_UUID })
  const deps = { ...validDepsUpload, token: '' }
  const response = await handleUpload(request, deps)

  assert.equal(response.status, 500)
  const body = (await response.json()) as { error: string }

  assert.equal(body.error, 'server token unset')
})

test('upload returns the upload_url and pathname for a valid request', async () => {
  const { handleUpload } = await loadHandlers()
  const request = makeRequest('POST', { instance_id: VALID_UUID })
  const response = await handleUpload(request, validDepsUpload)

  assert.equal(response.status, 200)
  const body = (await response.json()) as {
    upload_url: string
    pathname: string
  }

  assert.ok(body.upload_url.length > 0)
  assert.equal(body.pathname, `spend/instances/${VALID_UUID}.json.gz`)
})

test('upload sets Cache-Control: private, no-store', async () => {
  const { handleUpload } = await loadHandlers()
  const request = makeRequest('POST', { instance_id: VALID_UUID })
  const response = await handleUpload(request, validDepsUpload)

  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})

test('list returns 401 for a missing token', async () => {
  const { handleList } = await loadHandlers()
  const request = new Request('http://localhost/api/snapshots', {
    method: 'GET',
  })
  const response = await handleList(request, validDepsList)

  assert.equal(response.status, 401)
})

test('list returns 405 for a wrong method', async () => {
  const { handleList } = await loadHandlers()
  const request = makeRequestWithAuth('POST', 'Bearer correct-token')
  const response = await handleList(request, validDepsList)

  assert.equal(response.status, 405)
})

test('list returns the snapshots array with instance_id, uploaded_at, size, and download_url', async () => {
  const { handleList } = await loadHandlers()
  const request = makeRequestWithAuth('GET', 'Bearer correct-token')
  const response = await handleList(request, validDepsList)

  assert.equal(response.status, 200)
  const body = (await response.json()) as { snapshots: unknown[] }

  assert.equal(body.snapshots.length, 1)
  const snap = body.snapshots[0] as {
    instance_id: string
    uploaded_at: string
    size: number
    download_url: string
  }

  assert.equal(snap.instance_id, VALID_UUID)
  assert.ok(snap.download_url.length > 0)
})

test('list sets Cache-Control: private, no-store', async () => {
  const { handleList } = await loadHandlers()
  const request = makeRequestWithAuth('GET', 'Bearer correct-token')
  const response = await handleList(request, validDepsList)

  assert.equal(response.headers.get('cache-control'), 'private, no-store')
})
