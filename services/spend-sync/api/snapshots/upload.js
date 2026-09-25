/**
 * POST /api/snapshots/upload
 *
 * Returns a private put-scoped Signed URL for `spend/instances/<id>.json.gz`,
 * valid for 10 minutes.
 */
import * as blob from '@vercel/blob'

import { createBlobDeps } from '../../lib/blob-deps.js'
import { handleUpload } from '../../lib/handlers.js'

export function POST(request) {
  return handleUpload(request, createBlobDeps(blob, process.env))
}
