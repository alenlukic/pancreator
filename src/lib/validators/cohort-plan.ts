import path from 'node:path'

import {
  fileExists,
  isRecord,
  readJson,
  readText,
  referenceContentSha256,
} from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

type Issues = HandlerResult['issues']

const CHILD_SPEC_SECTIONS = [
  'Objective',
  'In scope',
  'Out of scope',
  'Acceptance criteria',
  'Dependencies',
  'Validation',
  'Handoff contract',
] as const

const PARENT_REFERENCE_HEADING = 'Parent specification'

/**
 * Longest run of parent prose a child specification may repeat verbatim.
 *
 * A child that pastes the parent body defeats the reference: the run then reads
 * a copy that drifts silently. Short overlaps are unavoidable, because both
 * documents name the same requirements, so only a long contiguous run counts as
 * a paste.
 */
const PASTED_PARENT_RUN_WORDS = 40

function issue(code: string, message: string): Issues[number] {
  return { code, message }
}

function result(issues: Issues): HandlerResult {
  return { status: issues.length > 0 ? 'failed' : 'passed', issues }
}

interface PlanChunk {
  id: string
  cohort_index: number
  child_spec_path: string
  depends_on: string[]
  /** Whether the entry declared `depends_on` at all, as the plan contract requires. */
  declares_depends_on: boolean
}

interface ReadPlan {
  parent_spec_path: string
  chunks: PlanChunk[]
  edges: Array<{ from: string; to: string }>
  cohorts: Array<{ index: number; chunks: string[] }>
  /** Originating item ids the plan disposes as shared rather than owned. */
  shared_items: string[]
  serial_justification: string
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function readPlan(value: unknown): ReadPlan | null {
  if (!isRecord(value)) {
    return null
  }

  const chunks = (Array.isArray(value.chunks) ? value.chunks : []).flatMap(
    (chunk) => {
      if (
        !isRecord(chunk) ||
        typeof chunk.id !== 'string' ||
        typeof chunk.child_spec_path !== 'string' ||
        !Number.isInteger(chunk.cohort_index)
      ) {
        return []
      }

      return [
        {
          id: chunk.id,
          cohort_index: Number(chunk.cohort_index),
          child_spec_path: chunk.child_spec_path,
          depends_on: stringArray(chunk.depends_on),
          declares_depends_on: Array.isArray(chunk.depends_on),
        },
      ]
    },
  )
  const edges = (Array.isArray(value.edges) ? value.edges : []).flatMap(
    (edge) =>
      isRecord(edge) &&
      typeof edge.from === 'string' &&
      typeof edge.to === 'string'
        ? [{ from: edge.from, to: edge.to }]
        : [],
  )
  const cohorts = (Array.isArray(value.cohorts) ? value.cohorts : []).flatMap(
    (group) =>
      isRecord(group) && Number.isInteger(group.index)
        ? [{ index: Number(group.index), chunks: stringArray(group.chunks) }]
        : [],
  )

  return {
    parent_spec_path:
      typeof value.parent_spec_path === 'string' ? value.parent_spec_path : '',
    chunks,
    edges,
    cohorts,
    shared_items: stringArray(value.shared_items),
    serial_justification:
      typeof value.serial_justification === 'string'
        ? value.serial_justification
        : '',
  }
}

/** Whether the dependency edges hold a cycle, reported by depth-first walk. */
function findCycle(
  chunkIds: string[],
  edges: Array<{ from: string; to: string }>,
): string[] | null {
  const outgoing = new Map<string, string[]>()

  for (const id of chunkIds) {
    outgoing.set(id, [])
  }

  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to)
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const walk = (id: string): string[] | null => {
    if (visiting.has(id)) {
      return [...stack.slice(stack.indexOf(id)), id]
    }

    if (visited.has(id)) {
      return null
    }

    visiting.add(id)
    stack.push(id)

    for (const next of outgoing.get(id) ?? []) {
      const cycle = walk(next)

      if (cycle) {
        return cycle
      }
    }

    stack.pop()
    visiting.delete(id)
    visited.add(id)
    return null
  }

  for (const id of chunkIds) {
    const cycle = walk(id)

    if (cycle) {
      return cycle
    }
  }

  return null
}

/**
 * Check the cohort plan of a ratified planning stage output.
 *
 * Every rule here is a fan-out precondition: a cycle, a dependency inside one
 * cohort, or a dependency on a later cohort would have the harness create
 * parallel runs whose inputs do not exist yet. Reporting them at the planning
 * gate is the last point where the plan can still be corrected cheaply.
 */
export function validateCohortPlan(input: HandlerInput): HandlerResult {
  const issues: Issues = []
  const absolute = path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return result([
      issue(
        'cohort.output_missing',
        `Stage output not found: ${input.targetPath}`,
      ),
    ])
  }

  const output = readJson(absolute)
  const data = isRecord(output) && isRecord(output.data) ? output.data : {}
  const plan = readPlan(data.cohort_plan)

  if (!plan) {
    return result([
      issue('cohort.plan_missing', 'data.cohort_plan MUST be an object'),
    ])
  }

  if (plan.parent_spec_path.length === 0) {
    issues.push(
      issue(
        'cohort.parent_spec_path',
        'data.cohort_plan.parent_spec_path MUST name the parent specification',
      ),
    )
  } else if (!fileExists(path.join(input.root, plan.parent_spec_path))) {
    issues.push(
      issue(
        'cohort.parent_spec_missing',
        `Parent specification does not exist: ${plan.parent_spec_path}`,
      ),
    )
  }

  if (plan.chunks.length === 0) {
    return result([
      ...issues,
      issue(
        'cohort.chunks_missing',
        'data.cohort_plan.chunks MUST list at least one chunk with id, cohort_index, and child_spec_path',
      ),
    ])
  }

  const chunkById = new Map(plan.chunks.map((chunk) => [chunk.id, chunk]))

  // A serial plan is a legitimate outcome, not a planning failure, so it is
  // accepted with a stated reason rather than refused.
  if (
    plan.chunks.length === 1 &&
    plan.serial_justification.trim().length === 0
  ) {
    issues.push(
      issue(
        'cohort.serial_justification',
        'A single-chunk cohort plan MUST state data.cohort_plan.serial_justification',
      ),
    )
  }

  for (const chunk of plan.chunks) {
    if (!fileExists(path.join(input.root, chunk.child_spec_path))) {
      issues.push(
        issue(
          'cohort.child_spec_missing',
          `Chunk '${chunk.id}' names a child specification that does not exist: ${chunk.child_spec_path}`,
        ),
      )
    }

    // An absent key would read as "no dependencies", which is the safe
    // default, but the plan contract asks the planner to state the empty list
    // so a forgotten dependency is distinguishable from a declared absence.
    if (!chunk.declares_depends_on) {
      issues.push(
        issue(
          'cohort.depends_on_missing',
          `Chunk '${chunk.id}' MUST declare depends_on, as an empty array when it depends on nothing`,
        ),
      )
    }

    for (const dependency of chunk.depends_on) {
      const target = chunkById.get(dependency)

      if (!target) {
        issues.push(
          issue(
            'cohort.unknown_dependency',
            `Chunk '${chunk.id}' depends on unknown chunk '${dependency}'`,
          ),
        )
        continue
      }

      if (target.cohort_index === chunk.cohort_index) {
        issues.push(
          issue(
            'cohort.intra_cohort_dependency',
            `Chunk '${chunk.id}' depends on '${dependency}' inside cohort ${chunk.cohort_index}, so the two cannot run in parallel`,
          ),
        )
        continue
      }

      if (target.cohort_index > chunk.cohort_index) {
        issues.push(
          issue(
            'cohort.forward_dependency',
            `Chunk '${chunk.id}' in cohort ${chunk.cohort_index} depends on '${dependency}' in later cohort ${target.cohort_index}`,
          ),
        )
      }
    }
  }

  for (const edge of plan.edges) {
    const from = chunkById.get(edge.from)
    const to = chunkById.get(edge.to)

    if (!from || !to) {
      issues.push(
        issue(
          'cohort.unknown_edge',
          `Edge ${edge.from} -> ${edge.to} names a chunk the plan does not declare`,
        ),
      )
      continue
    }

    if (from.cohort_index === to.cohort_index) {
      issues.push(
        issue(
          'cohort.intra_cohort_edge',
          `Edge ${edge.from} -> ${edge.to} sits inside cohort ${from.cohort_index}, so the two chunks cannot run in parallel`,
        ),
      )
    }
  }

  const cycle = findCycle(
    plan.chunks.map((chunk) => chunk.id),
    [
      ...plan.edges,
      ...plan.chunks.flatMap((chunk) =>
        chunk.depends_on.map((dependency) => ({
          from: dependency,
          to: chunk.id,
        })),
      ),
    ],
  )

  if (cycle) {
    issues.push(
      issue(
        'cohort.cycle',
        `The chunk dependency graph holds a cycle: ${cycle.join(' -> ')}`,
      ),
    )
  }

  const declaredCohortIndexes = new Set(
    plan.cohorts.map((group) => group.index),
  )

  for (const chunk of plan.chunks) {
    if (!declaredCohortIndexes.has(chunk.cohort_index)) {
      issues.push(
        issue(
          'cohort.unlisted_chunk',
          `Chunk '${chunk.id}' claims cohort ${chunk.cohort_index}, which data.cohort_plan.cohorts does not declare`,
        ),
      )
    }
  }

  for (const group of plan.cohorts) {
    // An empty cohort can never be satisfied, because satisfaction needs every
    // chunk run of the cohort to succeed and there is none, so it pins the
    // fan-out on itself forever.
    if (group.chunks.length === 0) {
      issues.push(
        issue(
          'cohort.empty_group',
          `Cohort ${group.index} lists no chunks, so it could never be satisfied and would block every later cohort`,
        ),
      )
    }

    for (const chunkId of group.chunks) {
      const chunk = chunkById.get(chunkId)

      if (!chunk) {
        issues.push(
          issue(
            'cohort.unknown_group_member',
            `Cohort ${group.index} names unknown chunk '${chunkId}'`,
          ),
        )
        continue
      }

      if (chunk.cohort_index !== group.index) {
        issues.push(
          issue(
            'cohort.group_mismatch',
            `Cohort ${group.index} names chunk '${chunkId}', which claims cohort ${chunk.cohort_index}`,
          ),
        )
      }
    }
  }

  return result(issues)
}

function sectionBody(content: string, heading: string): string | null {
  const lines = content.split('\n')
  const pattern = new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'iu')
  const start = lines.findIndex((line) => pattern.test(line.trim()))

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

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * Longest contiguous run of words the child repeats from the parent.
 *
 * Compared on normalized words rather than raw bytes, so reformatting or a
 * changed list marker cannot hide a paste.
 */
function longestSharedRun(parent: string[], child: string[]): number {
  const parentRuns = new Set<string>()

  for (
    let index = 0;
    index + PASTED_PARENT_RUN_WORDS <= parent.length;
    index += 1
  ) {
    parentRuns.add(
      parent.slice(index, index + PASTED_PARENT_RUN_WORDS).join(' '),
    )
  }

  for (
    let index = 0;
    index + PASTED_PARENT_RUN_WORDS <= child.length;
    index += 1
  ) {
    if (
      parentRuns.has(
        child.slice(index, index + PASTED_PARENT_RUN_WORDS).join(' '),
      )
    ) {
      return PASTED_PARENT_RUN_WORDS
    }
  }

  return 0
}

/**
 * Identifier a plain-string originating item opens with, such as `C-1` in
 * `C-1: Do not weaken any PLAN-002 guarantee.` or `Q1` in `Q1: Who owns ...?`.
 *
 * The planner writes user stories as objects with an `id`, and writes
 * constraints, out-of-scope statements, and open questions as strings that
 * open with their identifier. Both shapes carry an identifier the child
 * specifications trace, so both must count.
 */
const LEADING_IDENTIFIER =
  /^\s*([A-Za-z][A-Za-z0-9]*-?[0-9]+)\s*(?::|\.|-|—|–|\))/u

function leadingIdentifier(text: string): string | null {
  const match = LEADING_IDENTIFIER.exec(text)

  return match ? match[1] : null
}

function originatingItemId(entry: unknown): string | null {
  if (isRecord(entry)) {
    return typeof entry.id === 'string' ? entry.id : null
  }

  return typeof entry === 'string' ? leadingIdentifier(entry) : null
}

const ORIGINATING_ITEM_KEYS = [
  'user_stories',
  'constraints',
  'out_of_scope',
  'open_questions',
] as const

function originatingIds(data: Record<string, unknown>): string[] {
  const spec = isRecord(data.product_spec) ? data.product_spec : {}
  const ids = new Set<string>()

  for (const key of ORIGINATING_ITEM_KEYS) {
    const entries = Array.isArray(spec[key]) ? spec[key] : []

    for (const entry of entries) {
      const id = originatingItemId(entry)

      if (id !== null) {
        ids.add(id)
      }
    }
  }

  return [...ids].sort()
}

/**
 * JSON paths of the originating items that carry no identifier.
 *
 * An item without an identifier cannot be traced by any child specification,
 * so the exactly-once check could never fire for it. Reporting it keeps the
 * traceability guarantee honest instead of letting unlabeled prose bypass it.
 */
function unlabeledOriginatingItems(data: Record<string, unknown>): string[] {
  const spec = isRecord(data.product_spec) ? data.product_spec : {}
  const paths: string[] = []

  for (const key of ORIGINATING_ITEM_KEYS) {
    const entries = Array.isArray(spec[key]) ? spec[key] : []

    entries.forEach((entry, index) => {
      if (originatingItemId(entry) === null) {
        paths.push(`product_spec.${key}[${index}]`)
      }
    })
  }

  return paths
}

/** Question ids the plan disposed as deferred or escalated. */
function undeliveredQuestionIds(data: Record<string, unknown>): Set<string> {
  const dispositions = Array.isArray(data.open_question_dispositions)
    ? data.open_question_dispositions
    : []
  const ids = new Set<string>()

  for (const entry of dispositions) {
    if (
      isRecord(entry) &&
      typeof entry.id === 'string' &&
      (entry.disposition === 'deferred' || entry.disposition === 'escalated')
    ) {
      ids.add(entry.id)
    }
  }

  return ids
}

/**
 * Check every child specification a ratified cohort plan names.
 *
 * The child specifications are the requests the fanned-out delivery runs
 * receive, so a missing section, a malformed parent reference, or an
 * untraced requirement becomes a chunk that implements the wrong scope. An
 * item traced more than once becomes two runs editing the same behavior in
 * parallel, which is exactly what the cohort split exists to prevent. An item
 * the plan declares shared is exempt, because a cross-cutting constraint binds
 * every chunk that carries it.
 */
export function validateChildSpecifications(
  input: HandlerInput,
): HandlerResult {
  const issues: Issues = []
  const absolute = path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return result([
      issue(
        'child.output_missing',
        `Stage output not found: ${input.targetPath}`,
      ),
    ])
  }

  const output = readJson(absolute)
  const data = isRecord(output) && isRecord(output.data) ? output.data : {}
  const plan = readPlan(data.cohort_plan)

  if (!plan || plan.chunks.length === 0) {
    return result([
      issue(
        'child.plan_missing',
        'data.cohort_plan MUST declare the chunks whose child specifications this validator checks',
      ),
    ])
  }

  const parentAbsolute = path.join(input.root, plan.parent_spec_path)
  const parentText =
    plan.parent_spec_path.length > 0 && fileExists(parentAbsolute)
      ? readText(parentAbsolute)
      : null
  const parentWords = parentText === null ? [] : normalizedWords(parentText)
  // The chunk card recomputes the parent digest on the trimmed basis, so a
  // child that recorded the raw-file digest reports drift against every card
  // even though nobody edited the parent. Checking the value here catches the
  // wrong basis at the plan gate, before any chunk run reads it.
  const parentDigest =
    parentText === null ? null : referenceContentSha256(parentText)
  const ownership = new Map<string, string[]>()

  for (const chunk of plan.chunks) {
    const childAbsolute = path.join(input.root, chunk.child_spec_path)

    if (!fileExists(childAbsolute)) {
      issues.push(
        issue(
          'child.missing',
          `Chunk '${chunk.id}' names a child specification that does not exist: ${chunk.child_spec_path}`,
        ),
      )
      continue
    }

    const content = readText(childAbsolute)

    for (const heading of CHILD_SPEC_SECTIONS) {
      if (sectionBody(content, heading) === null) {
        issues.push(
          issue(
            'child.section_missing',
            `${chunk.child_spec_path} MUST carry a '${heading}' section`,
          ),
        )
      }
    }

    const reference = sectionBody(content, PARENT_REFERENCE_HEADING)

    if (reference === null) {
      issues.push(
        issue(
          'child.parent_reference_missing',
          `${chunk.child_spec_path} MUST open with a '${PARENT_REFERENCE_HEADING}' reference block`,
        ),
      )
    } else {
      if (!reference.includes(plan.parent_spec_path)) {
        issues.push(
          issue(
            'child.parent_reference_path',
            `${chunk.child_spec_path} parent reference MUST name ${plan.parent_spec_path}`,
          ),
        )
      }

      const recordedDigest = /sha256:([0-9a-f]{64})/u.exec(reference)?.[1]

      if (recordedDigest === undefined) {
        issues.push(
          issue(
            'child.parent_reference_digest',
            `${chunk.child_spec_path} parent reference MUST carry the parent's sha256 content digest`,
          ),
        )
      } else if (parentDigest !== null && recordedDigest !== parentDigest) {
        issues.push(
          issue(
            'child.parent_reference_digest_mismatch',
            `${chunk.child_spec_path} parent reference records sha256:${recordedDigest}, but ${plan.parent_spec_path} digests to sha256:${parentDigest} on the reference basis (SHA-256 of the file after leading and trailing whitespace is trimmed). Record that value.`,
          ),
        )
      }

      if (!/read when/iu.test(reference)) {
        issues.push(
          issue(
            'child.parent_reference_trigger',
            `${chunk.child_spec_path} parent reference MUST state the read trigger`,
          ),
        )
      }

      if (!/selected range/iu.test(reference)) {
        issues.push(
          issue(
            'child.parent_reference_range',
            `${chunk.child_spec_path} parent reference MUST state the selected range`,
          ),
        )
      }
    }

    if (
      parentWords.length > 0 &&
      longestSharedRun(parentWords, normalizedWords(content)) > 0
    ) {
      issues.push(
        issue(
          'child.parent_body_pasted',
          `${chunk.child_spec_path} repeats at least ${PASTED_PARENT_RUN_WORDS} consecutive words of the parent specification. Reference the parent instead of copying it.`,
        ),
      )
    }

    // Ownership is read from `In scope` only. An id a child names under
    // `Out of scope` or `Dependencies` is deliberately owned elsewhere, so
    // counting those would report every shared boundary as a double trace.
    const inScope = sectionBody(content, 'In scope') ?? ''

    for (const id of originatingIds(data)) {
      if (new RegExp(`\\b${id.replaceAll('.', '\\.')}\\b`, 'u').test(inScope)) {
        ownership.set(id, [...(ownership.get(id) ?? []), chunk.id])
      }
    }
  }

  for (const itemPath of unlabeledOriginatingItems(data)) {
    issues.push(
      issue(
        'child.unlabeled_item',
        `${itemPath} carries no identifier, so no child specification can trace it. Open the item with its identifier, such as 'C-1:' or 'Q-1:'.`,
      ),
    )
  }

  const deferred = undeliveredQuestionIds(data)
  const identified = new Set(originatingIds(data))
  const shared = new Set(plan.shared_items)

  // A shared declaration suspends the double-trace rule for one item, so an id
  // the specification never declared would suspend nothing and read as an
  // accepted disposition. Report it rather than accept a silent no-op.
  for (const id of plan.shared_items) {
    if (!identified.has(id)) {
      issues.push(
        issue(
          'child.unknown_shared_item',
          `data.cohort_plan.shared_items declares '${id}' as shared, which no originating item of the product specification carries.`,
        ),
      )
    }
  }

  for (const id of identified) {
    if (deferred.has(id)) {
      continue
    }

    const owners = ownership.get(id) ?? []

    if (owners.length === 0) {
      issues.push(
        issue(
          'child.untraced_item',
          `Originating item '${id}' is traced by no child specification. Own it in one chunk, share it across the chunks that carry it, or dispose it as deferred or escalated.`,
        ),
      )
      continue
    }

    // A cross-cutting item legitimately spans several chunks. The plan states
    // that disposition, so every child that names a shared item traces it on
    // purpose rather than claiming another chunk's ownership.
    if (shared.has(id)) {
      continue
    }

    if (owners.length > 1) {
      issues.push(
        issue(
          'child.double_traced_item',
          `Originating item '${id}' is owned by more than one chunk: ${owners.join(', ')}. Declare it in data.cohort_plan.shared_items when the chunks share it.`,
        ),
      )
    }
  }

  return result(issues)
}
