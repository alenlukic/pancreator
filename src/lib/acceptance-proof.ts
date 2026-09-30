import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
} from './io.js'

/**
 * How one acceptance criterion is proven (`PLAN-002`, `VERIFY-001`).
 *
 * - `test`: a gate lane proves it.
 * - `review`: reading the code proves it.
 * - `live`: it needs a browser or app check, which QA runs.
 * - `observe`: it needs a signal after ship, so verify defers it.
 */
export const ACCEPTANCE_PROOF_TYPES = [
  'test',
  'review',
  'live',
  'observe',
] as const

export type AcceptanceProof = (typeof ACCEPTANCE_PROOF_TYPES)[number]

export function isAcceptanceProof(value: unknown): value is AcceptanceProof {
  return (
    typeof value === 'string' &&
    (ACCEPTANCE_PROOF_TYPES as readonly string[]).includes(value)
  )
}

/**
 * Proof of each criterion a run carries, keyed by criterion id. `null` marks
 * a criterion that declares no valid proof, such as one from a plan written
 * before the field existed.
 */
export type AcceptanceProofs = Map<string, AcceptanceProof | null>

/** Criterion proofs of a plan output's `data.acceptance_criteria`. */
export function acceptanceProofsFromPlanData(data: unknown): AcceptanceProofs {
  const criteria =
    isRecord(data) && Array.isArray(data.acceptance_criteria)
      ? data.acceptance_criteria
      : []
  const proofs: AcceptanceProofs = new Map()

  for (const item of criteria) {
    if (isRecord(item) && typeof item.id === 'string') {
      proofs.set(item.id, isAcceptanceProof(item.proof) ? item.proof : null)
    }
  }

  return proofs
}

/**
 * One criterion line of a specification's `Acceptance criteria` section, in
 * the form `1. AC-001 [proof: live] <statement>`. The raw tag is kept so a
 * validator can name an unknown value rather than report it as absent.
 */
export interface AcceptanceCriterionLine {
  id: string
  /** Tag value as written, lowercased; null when the line carries no tag. */
  tag: string | null
}

const CRITERION_LINE =
  /^\s*(?:[-*+]|\d+[.)])\s+[*_`]*(AC-[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*)[*_`]*(.*)$/u
const PROOF_TAG = /\[proof:\s*([A-Za-z_-]+)\s*\]/iu

function acceptanceSection(content: string): string | null {
  const lines = content.split('\n')
  const start = lines.findIndex((line) =>
    /^#{1,6}\s+Acceptance criteria\s*$/iu.test(line.trim()),
  )

  if (start === -1) {
    return null
  }

  const body: string[] = []

  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+\S/u.test(line.trim())) {
      break
    }

    body.push(line)
  }

  return body.join('\n')
}

/** Every criterion line of a Markdown specification's acceptance section. */
export function acceptanceCriterionLines(
  content: string,
): AcceptanceCriterionLine[] {
  const section = acceptanceSection(content)

  if (section === null) {
    return []
  }

  return section.split('\n').flatMap((line) => {
    const match = CRITERION_LINE.exec(line)

    if (!match) {
      return []
    }

    const tag = PROOF_TAG.exec(match[2])?.[1]?.toLowerCase() ?? null

    return [{ id: match[1], tag }]
  })
}

/** Criterion proofs a Markdown specification's criterion lines declare. */
export function acceptanceProofsFromMarkdown(
  content: string,
): AcceptanceProofs {
  const proofs: AcceptanceProofs = new Map()

  for (const line of acceptanceCriterionLines(content)) {
    proofs.set(line.id, isAcceptanceProof(line.tag) ? line.tag : null)
  }

  return proofs
}

function readRelativeText(root: string, relativePath: string): string | null {
  try {
    const absolute = resolveInside(root, relativePath)

    return fileExists(absolute) ? readText(absolute) : null
  } catch {
    return null
  }
}

function readRelativeJson(root: string, relativePath: string): unknown {
  try {
    const absolute = resolveInside(root, relativePath)

    return fileExists(absolute) ? readJson(absolute) : null
  } catch {
    return null
  }
}

/**
 * Child specifications a cohort session lists, for a release run whose
 * acceptance criteria live in them rather than in a plan of its own.
 */
function cohortChildSpecPaths(root: string, cohortId: string): string[] {
  const session = readRelativeJson(
    root,
    path.join('runtime', 'logs', 'cohorts', cohortId, 'state.json'),
  )

  if (!isRecord(session) || !Array.isArray(session.chunks)) {
    return []
  }

  return session.chunks.flatMap((chunk) =>
    isRecord(chunk) &&
    typeof chunk.child_spec_path === 'string' &&
    chunk.abandoned === undefined
      ? [chunk.child_spec_path]
      : [],
  )
}

/**
 * The criterion proofs of a run, from the most authoritative source it has:
 * its own latest successful plan output, then the child specifications a
 * release run lists, then the request specification. An empty map means no
 * source names a criterion, which a caller treats as unknown.
 *
 * The state is read loosely because the stage validators receive it as an
 * untyped record.
 */
export function runAcceptanceProofs(
  root: string,
  state: Record<string, unknown> | undefined,
): AcceptanceProofs {
  if (!state) {
    return new Map()
  }

  const history = Array.isArray(state.stage_history) ? state.stage_history : []
  const plan = [...history]
    .reverse()
    .find(
      (item) =>
        isRecord(item) &&
        item.stage === 'plan' &&
        item.outcome === 'success' &&
        typeof item.output_path === 'string',
    ) as Record<string, unknown> | undefined

  if (plan) {
    const value = readRelativeJson(root, plan.output_path as string)
    const proofs = acceptanceProofsFromPlanData(
      isRecord(value) ? value.data : null,
    )

    if (proofs.size > 0) {
      return proofs
    }
  }

  const cohort = isRecord(state.cohort) ? state.cohort : null

  if (cohort?.role === 'release' && typeof cohort.cohort_id === 'string') {
    const proofs: AcceptanceProofs = new Map()

    for (const specPath of cohortChildSpecPaths(root, cohort.cohort_id)) {
      const content = readRelativeText(root, specPath)

      for (const [id, proof] of acceptanceProofsFromMarkdown(content ?? '')) {
        proofs.set(id, proof)
      }
    }

    return proofs
  }

  const request = isRecord(state.request) ? state.request : null
  const requestPath =
    typeof request?.stored_path === 'string' ? request.stored_path : null
  const content = requestPath ? readRelativeText(root, requestPath) : null

  return content ? acceptanceProofsFromMarkdown(content) : new Map()
}

/** Why QA runs or not on this visit, from the run's criterion proofs. */
export type LiveCriteriaDecision =
  | { run: true; reason: string }
  | { run: false; reason: string }

/**
 * Whether the run carries a criterion only QA can prove (`VERIFY-001`).
 *
 * QA runs for any `live` criterion. It also runs when the proofs are unknown:
 * no criterion found, or one without a valid proof. That keeps a legacy or
 * unplanned request on the full topology rather than silently dropping QA.
 */
export function liveCriteriaDecision(
  proofs: AcceptanceProofs,
): LiveCriteriaDecision {
  if (proofs.size === 0) {
    return {
      run: true,
      reason: 'no acceptance criterion with a proof type was found',
    }
  }

  const untagged = [...proofs].filter(([, proof]) => proof === null)

  if (untagged.length > 0) {
    return {
      run: true,
      reason:
        'acceptance criteria carry no proof type: ' +
        untagged.map(([id]) => id).join(', '),
    }
  }

  const live = [...proofs].filter(([, proof]) => proof === 'live')

  if (live.length > 0) {
    return {
      run: true,
      reason:
        'acceptance criteria need a live check: ' +
        live.map(([id]) => id).join(', '),
    }
  }

  const counts = ACCEPTANCE_PROOF_TYPES.flatMap((type) => {
    const count = [...proofs.values()].filter((proof) => proof === type).length

    return count > 0 ? [`${count} ${type}`] : []
  })

  return {
    run: false,
    reason:
      `no acceptance criterion has proof \`live\` (${counts.join(', ')}); ` +
      'gate evidence proves `test` criteria, the reviewer proves `review` ' +
      'criteria, and `observe` criteria wait for a signal after ship',
  }
}
