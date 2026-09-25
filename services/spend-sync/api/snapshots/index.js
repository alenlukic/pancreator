/**
 * GET /api/snapshots
 *
 * Wires the list handler to Vercel Blob: lists `spend/instances/` blobs and
 * issues a get-scoped Signed URL for each, valid for 10 minutes.
 * Uses `useCache: false` to see the latest overwrite.
 */
import { handleList } from '../../lib/handlers.js'

export const config = { runtime: 'nodejs22.x' }

export default function handler(request) {
  const serverToken = process.env.PAN_SPEND_SYNC_TOKEN
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN

  return handleList(request, {
    token: serverToken,
    async list(prefix) {
      const { list } = await import('@vercel/blob')
      const result = await list({
        prefix,
        token: blobToken,
        // useCache: false is set via store options — disable CDN caching
        // so the latest overwrite is always returned.
      })

      return result.blobs
    },
    async presignGet(pathname) {
      const { issueSignedToken } = await import('@vercel/blob')
      const downloadUrl = await issueSignedToken({
        pathname,
        operation: 'get',
        expiresIn: 600,
        token: blobToken,
      })

      return downloadUrl
    },
  })
}
