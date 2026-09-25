/**
 * GET /api/snapshots
 *
 * Lists `spend/instances/` blobs and returns a private get-scoped Signed URL
 * for each, valid for 10 minutes and bypassing the CDN cache.
 */
import * as blob from '@vercel/blob'

import { createBlobDeps } from '../../lib/blob-deps.js'
import { handleList } from '../../lib/handlers.js'

export function GET(request) {
  return handleList(request, createBlobDeps(blob, process.env))
}
