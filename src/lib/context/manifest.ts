/** The context manifest an invocation writes. */

import path from 'node:path'

import { writeJsonAtomic } from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import type { InvocationReference } from '../types.js'
import type {
  AvailableReference,
  ContextManifest,
  InvocationContextOptions,
} from './references.js'

export function writeContextManifest(
  options: InvocationContextOptions,
  selected: InvocationReference[],
  omitted: AvailableReference[],
  missingRequired: string[],
): InvocationReference | null {
  if (omitted.length === 0 && missingRequired.length === 0) {
    return null
  }

  const relativePath = resolveRunLayout(
    options.root,
    options.state.run_id,
  ).invocation(options.invocationId, '.context-manifest.json').relative
  const manifest: ContextManifest = {
    schema_version: 1,
    invocation_id: options.invocationId,
    stage: options.stage.slug,
    generated_at: new Date().toISOString(),
    selected,
    omitted,
    missing_required: missingRequired,
  }

  writeJsonAtomic(path.join(options.root, relativePath), manifest)

  return {
    path: relativePath,
    description:
      'Complete workflow context index, including omitted and superseded records',
    retrieval: 'index_only',
    condition:
      'Do not expand merely because it is listed. Read only to resolve a named inconsistency, missing disposition, provenance question, or missing required input.',
  }
}
