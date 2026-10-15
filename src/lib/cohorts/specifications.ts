import { lstatSync } from 'node:fs'
import path from 'node:path'

import { buildContextReference } from '../context/references.js'
import { errorMessage, invariant, PanError } from '../errors.js'
import {
  appendJsonLine,
  isRecord,
  readText,
  resolveInside,
  withOperationMutex,
  writeTextAtomic,
} from '../io.js'
import { resolveRunLayout } from '../run-layout.js'
import type { RunState } from '../types.js'

interface SpecificationSnapshot {
  relative: string
  absolute: string
  content: string
  identity: string
}

function reject(message: string): never {
  throw new PanError(`Planning reference finalization: ${message}`, {
    code: 'PLANNING_REFERENCE_UNSAFE',
  })
}

function snapshot(
  root: string,
  directory: string,
  relative: unknown,
): SpecificationSnapshot {
  if (
    typeof relative !== 'string' ||
    !relative.startsWith(`${directory}/`) ||
    relative.includes('\\') ||
    relative
      .split('/')
      .some((part) => part === '.' || part === '..' || part === '')
  ) {
    reject(
      `specification path must be a canonical path inside ${directory}: ${String(relative)}`,
    )
  }

  const absolute = resolveInside(root, relative)
  let ancestor = root

  for (const part of relative.split('/')) {
    ancestor = path.join(ancestor, part)
    invariant(
      !lstatSync(ancestor).isSymbolicLink(),
      `Specification path is a symlink: ${relative}`,
      {
        code: 'PLANNING_REFERENCE_UNSAFE',
      },
    )
  }

  const stat = lstatSync(absolute)

  if (!stat.isFile() || stat.nlink !== 1) {
    reject(
      `specification must be a regular file without hard-link aliases: ${relative}`,
    )
  }

  return {
    relative,
    absolute,
    content: readText(absolute),
    identity: `${stat.dev}:${stat.ino}`,
  }
}

function finalizedChild(
  child: SpecificationSnapshot,
  parent: string,
  digest: string,
): string {
  const lines = child.content.split('\n')
  const headings = lines.flatMap((line, index) =>
    /^#{1,6}\s+Parent specification\s*$/iu.test(line.trim()) ? [index] : [],
  )

  if (headings.length !== 1) {
    reject(`${child.relative} must have exactly one Parent specification block`)
  }

  const start = headings[0] + 1
  const next = lines.findIndex(
    (line, index) => index >= start && /^#{1,6}\s+\S/u.test(line.trim()),
  )
  const end = next === -1 ? lines.length : next
  const block = lines.slice(start, end)
  const fields = (name: string) =>
    block.flatMap((line, index) =>
      new RegExp(`^\\s*-\\s+${name}:\\s*`, 'iu').test(line) ? [index] : [],
    )
  const sources = fields('Source')
  const digests = fields('Content digest')
  const statuses = fields('Reference status')

  if (
    sources.length !== 1 ||
    digests.length !== 1 ||
    statuses.length > 1 ||
    fields('Selected range').length !== 1 ||
    fields('Read when').length !== 1
  ) {
    reject(`${child.relative} has missing or ambiguous parent reference fields`)
  }

  for (const field of ['Selected range', 'Read when']) {
    const line = block[fields(field)[0]]

    if (
      line
        .slice(line.indexOf(':') + 1)
        .replaceAll('`', '')
        .trim().length === 0
    ) {
      reject(`${child.relative} has an empty ${field} field`)
    }
  }

  const source = block[sources[0]].replace(/^\s*-\s+Source:\s*/iu, '').trim()

  if (source !== parent && source !== `\`${parent}\``) {
    reject(`${child.relative} names a different parent: ${source}`)
  }

  const digestLine = block[digests[0]]
  const token =
    /^(.*Content digest:\s*`?)(harness-pending|sha256:[0-9a-f]{64})(`?\s*)$/iu.exec(
      digestLine,
    )

  if (
    !token ||
    /sha256:|harness-pending/iu.test(
      block.filter((_, index) => index !== digests[0]).join('\n'),
    )
  ) {
    reject(
      `${child.relative} must carry one canonical digest or the draft harness-pending token`,
    )
  }

  block[digests[0]] = `${token[1]}sha256:${digest}${token[3]}`

  if (statuses.length === 1) {
    block[statuses[0]] = block[statuses[0]].replace(
      /^(.*Reference status:\s*).*$/iu,
      '$1current',
    )
  }

  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('\n')
}

/**
 * Finalize only declared child reference metadata of an active, unsubmitted
 * planning invocation that has not explicitly reported failure or blocked,
 * using one canonical parent snapshot. Pure validators still reject pending
 * and stale digests. Partial writes fail explicitly and
 * may be retried idempotently; worker claims are never mutated.
 */
export function finalizePlanningReferences(
  root: string,
  state: Pick<
    RunState,
    | 'workflow_slug'
    | 'status'
    | 'current_stage'
    | 'current_invocation'
    | 'stage_history'
    | 'run_id'
    | 'pending_action'
  >,
  output: unknown,
  expectedInvocationId: string | null,
): void {
  if (
    state.workflow_slug !== 'planning' ||
    !isRecord(output) ||
    output.result === 'failure' ||
    output.result === 'blocked' ||
    !isRecord(output.data) ||
    !('cohort_plan' in output.data)
  ) {
    return
  }

  // Re-submission of a completed invocation must remain read-only.
  if (
    state.stage_history.some(
      (item) => item.invocation_id === output.invocation_id,
    ) ||
    state.current_invocation === null
  ) {
    return
  }

  invariant(
    state.status === 'running' &&
      state.current_stage === 'plan' &&
      state.pending_action.type === 'invoke_agent' &&
      state.current_invocation.id === expectedInvocationId &&
      output.invocation_id === expectedInvocationId,
    'Planning references can be finalized only for the active unratified planning output.',
    { code: 'PLANNING_REFERENCE_INACTIVE' },
  )

  const plan = output.data.cohort_plan

  invariant(
    isRecord(plan) && Array.isArray(plan.chunks) && plan.chunks.length > 0,
    'Planning reference finalization requires a parent and at least one declared child.',
    { code: 'PLANNING_REFERENCE_UNSAFE' },
  )

  const chunks = plan.chunks
  const layout = resolveRunLayout(root, state.run_id)
  const directory = `${layout.operator.relative}/specs`
  const auditPath = layout.evidence(
    `${expectedInvocationId}-planning-references.jsonl`,
  ).absolute

  withOperationMutex(
    layout.evidence('planning-references.lock').absolute,
    () => {
      const changed: string[] = []
      let contentSha256: string | undefined

      try {
        const parent = snapshot(root, directory, plan.parent_spec_path)
        const reference = buildContextReference(root, parent.relative)

        contentSha256 = reference.content_sha256
        const seen = new Set([parent.identity])
        const children = chunks.map((chunk: unknown) => {
          invariant(
            isRecord(chunk),
            'Every declared planning chunk must be an object.',
            {
              code: 'PLANNING_REFERENCE_UNSAFE',
            },
          )
          const child = snapshot(root, directory, chunk.child_spec_path)

          if (seen.has(child.identity)) {
            reject(`duplicate child or parent used as child: ${child.relative}`)
          }

          seen.add(child.identity)

          return {
            ...child,
            finalized: finalizedChild(
              child,
              parent.relative,
              reference.content_sha256,
            ),
          }
        })
        const unchanged = (file: SpecificationSnapshot) => {
          const current = snapshot(root, directory, file.relative)

          invariant(
            current.identity === file.identity &&
              current.content === file.content,
            `Specification changed during finalization: ${file.relative}; retry against a fresh snapshot.`,
            { code: 'PLANNING_REFERENCE_CONCURRENT_EDIT' },
          )
        }

        unchanged(parent)

        for (const child of children) {
          unchanged(child)
        }

        for (const child of children) {
          unchanged(parent)
          unchanged(child)

          if (child.finalized !== child.content) {
            writeTextAtomic(child.absolute, child.finalized)
            changed.push(child.relative)
          }
        }

        unchanged(parent)

        if (changed.length > 0) {
          appendJsonLine(auditPath, {
            state: 'finalized',
            outcome: 'Declared child references match the parent snapshot.',
            blockers: [],
            next_action: 'Run strict plan and child validators.',
            invocation_id: expectedInvocationId,
            parent: reference,
            changed_reference_paths: changed,
            recorded_at: new Date().toISOString(),
          })
        }
      } catch (error) {
        appendJsonLine(auditPath, {
          state: 'failed',
          outcome: 'Planning reference finalization did not complete.',
          blocker: errorMessage(error),
          next_action:
            'Correct the input or write failure and retry finalization.',
          invocation_id: expectedInvocationId,
          changed_reference_paths: changed,
          ...(contentSha256 ? { content_sha256: contentSha256 } : {}),
          recorded_at: new Date().toISOString(),
        })
        throw error
      }
    },
  )
}
