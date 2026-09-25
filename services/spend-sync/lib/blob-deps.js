/**
 * Wires the handler deps to Vercel Blob private storage.
 *
 * `blob` is the `@vercel/blob` module, injected so tests can exercise the
 * wiring without the package. The functions never proxy snapshot bytes: they
 * return short-lived Signed URLs that the CLI transfers gzip bytes through.
 */
const SIGNED_URL_TTL_MS = 10 * 60 * 1000
const MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024

async function presign(blob, pathname, operation, urlOptions) {
  const validUntil = Date.now() + SIGNED_URL_TTL_MS
  const signedToken = await blob.issueSignedToken({
    pathname,
    operations: [operation],
    validUntil,
  })
  const { presignedUrl } = await blob.presignUrl(signedToken, {
    pathname,
    operation,
    access: 'private',
    validUntil,
    ...urlOptions,
  })

  return presignedUrl
}

/**
 * Build `{ token, presignPut, list, presignGet }` for `handleUpload` and
 * `handleList` from the `@vercel/blob` module and the process environment.
 */
export function createBlobDeps(blob, env) {
  return {
    token: env.PAN_SPEND_SYNC_TOKEN,
    presignPut: (pathname) =>
      presign(blob, pathname, 'put', {
        allowOverwrite: true,
        maximumSizeInBytes: MAX_SNAPSHOT_BYTES,
      }),
    // Reads bypass the CDN cache so each report sees the latest overwrite.
    presignGet: (pathname) =>
      presign(blob, pathname, 'get', { useCache: false }),
    async list(prefix) {
      const blobs = []
      let cursor

      do {
        const page = await blob.list(
          cursor === undefined ? { prefix } : { prefix, cursor },
        )

        blobs.push(...page.blobs)
        cursor = page.hasMore ? page.cursor : undefined
      } while (cursor !== undefined)

      return blobs
    },
  }
}
