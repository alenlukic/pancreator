/**
 * POST /api/snapshots/upload
 *
 * Wires the upload handler to Vercel Blob: issues a put-scoped Signed URL
 * for `spend/instances/<id>.json.gz`, valid for 10 minutes.
 */
import { createPutMethod } from '@vercel/blob/client'
import { handleUpload } from '../../lib/handlers.js'

export const config = { runtime: 'nodejs22.x' }

export default function handler(request) {
  const serverToken = process.env.PAN_SPEND_SYNC_TOKEN
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN

  return handleUpload(request, {
    token: serverToken,
    async presignPut(pathname) {
      // Issue a private put-scoped Signed URL valid for 10 minutes.
      const { issueSignedToken } = await import('@vercel/blob')
      const uploadUrl = await issueSignedToken({
        pathname,
        operation: 'put',
        maximumSizeInBytes: 50 * 1024 * 1024,
        expiresIn: 600,
        token: blobToken,
      })

      return uploadUrl
    },
  })
}
