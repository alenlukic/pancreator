/**
 * Dependency-free upload and list handlers for the spend-sync Vercel service.
 *
 * Each handler takes an HTTP request object and an injected `deps` bag so
 * tests can exercise the handlers without a real Blob store.
 *
 * deps = { token, presignPut(pathname), list(prefix), presignGet(pathname) }
 */
import { timingSafeEqual } from 'node:crypto'

const INSTANCE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const NO_STORE = 'private, no-store'

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': NO_STORE,
    },
  })
}

/**
 * Compare two strings in constant time. Returns true when they are equal.
 * Uses `timingSafeEqual` after converting both to equal-length buffers.
 */
function compareConstantTime(a, b) {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)

  // Padding to equal length before comparison prevents length leakage.
  const len = Math.max(bufA.length, bufB.length)
  const paddedA = Buffer.alloc(len)
  const paddedB = Buffer.alloc(len)

  bufA.copy(paddedA)
  bufB.copy(paddedB)

  return timingSafeEqual(paddedA, paddedB) && bufA.length === bufB.length
}

/**
 * Verify the `Authorization: Bearer <token>` header.
 * Returns the error Response, or null when the token is valid.
 */
function checkAuth(request, deps) {
  const serverToken = deps.token

  if (!serverToken) {
    return jsonResponse({ error: 'server token unset' }, 500)
  }

  const authHeader = request.headers.get('authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''

  if (!compareConstantTime(bearer, serverToken)) {
    return jsonResponse({ error: 'unauthorized' }, 401)
  }

  return null
}

/**
 * POST /api/snapshots/upload
 *
 * Body: `{ instance_id: string }`
 * Response: `{ upload_url: string, pathname: string }`
 *
 * deps = { token, presignPut(pathname) }
 */
export async function handleUpload(request, deps) {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  const authError = checkAuth(request, deps)

  if (authError) return authError

  let body
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400)
  }

  const instanceId = body?.instance_id

  if (typeof instanceId !== 'string' || !INSTANCE_ID_RE.test(instanceId)) {
    return jsonResponse(
      { error: 'instance_id must be a lowercase UUID v4' },
      400,
    )
  }

  const pathname = `spend/instances/${instanceId}.json.gz`
  const upload_url = await deps.presignPut(pathname)

  return jsonResponse({ upload_url, pathname })
}

/**
 * GET /api/snapshots
 *
 * Response: `{ snapshots: [{ instance_id, uploaded_at, size, download_url }] }`
 *
 * deps = { token, list(prefix), presignGet(pathname) }
 */
export async function handleList(request, deps) {
  if (request.method !== 'GET') {
    return jsonResponse({ error: 'method not allowed' }, 405)
  }

  const authError = checkAuth(request, deps)

  if (authError) return authError

  const blobs = await deps.list('spend/instances/')
  const snapshots = await Promise.all(
    blobs.map(async (blob) => {
      const instanceId = blob.pathname
        .replace('spend/instances/', '')
        .replace('.json.gz', '')

      const download_url = await deps.presignGet(blob.pathname)

      return {
        instance_id: instanceId,
        uploaded_at:
          blob.uploadedAt ?? blob.updatedAt ?? new Date().toISOString(),
        size: blob.size ?? 0,
        download_url,
      }
    }),
  )

  return jsonResponse({ snapshots })
}
