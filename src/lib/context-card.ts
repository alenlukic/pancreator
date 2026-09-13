import { invariant } from './errors.js'
import { fileExists, isRecord, readJson, resolveInside } from './io.js'
import { renderInvocationMarkdown } from './render.js'
import { resolveRunLayout } from './run-layout.js'
import { loadState } from './state.js'
import type { Invocation } from './types.js'

export interface RenderedInvocationCard {
  run_id: string
  invocation_id: string
  source_path: string
  markdown: string
}

/**
 * Render one invocation card from its recorded snapshot, reading only.
 *
 * An acceptance criterion whose evidence is a rendered card had no legitimate
 * producer: the only command that renders one is `pan prepare`, which is a
 * lifecycle command an evidence worker and a verifier may not run, and which
 * refuses an unattested supervisor. This render touches no run state, performs
 * no delegation, and requires no attestation, so the criterion has a producer
 * among the workers a plan assigns to prove it.
 */
export function renderRunInvocationCard(
  root: string,
  runId: string,
  invocationId?: string,
): RenderedInvocationCard {
  const layout = resolveRunLayout(root, runId)
  const resolvedId =
    invocationId ?? loadState(root, runId).current_invocation?.id

  invariant(
    resolvedId !== undefined,
    `Run ${runId} has no active invocation. Name one with --invocation <id>.`,
    { code: 'INVOCATION_NOT_FOUND', details: { run_id: runId } },
  )

  const sourcePath = layout.invocation(resolvedId, '.json').relative
  const absolute = resolveInside(root, sourcePath)

  invariant(
    fileExists(absolute),
    `Invocation record not found: ${sourcePath}`,
    {
      code: 'INVOCATION_NOT_FOUND',
      details: { run_id: runId, invocation_id: resolvedId, path: sourcePath },
    },
  )

  const value = readJson(absolute)

  invariant(
    isRecord(value) && typeof value.invocation_id === 'string',
    `${sourcePath} MUST contain a valid invocation.`,
    { code: 'INVALID_INVOCATION' },
  )

  return {
    run_id: runId,
    invocation_id: resolvedId,
    source_path: sourcePath,
    markdown: renderInvocationMarkdown(value as unknown as Invocation),
  }
}
