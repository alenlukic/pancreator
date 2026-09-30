/**
 * `pan governance refresh-digests`: rewrite the content digests the turn
 * reminder registry pins after an edit to a pinned source.
 *
 * A policy selector pins the SHA-256 of one policy instruction, and a card
 * selector pins the SHA-256 of one AGENTS card section per installation mode.
 * Editing either makes repository validation fail until the digest is
 * rewritten, and recomputing it by hand is error-prone busywork. This command
 * does it deterministically, and refuses rather than guesses when an edited
 * instruction cannot be matched to exactly one current instruction.
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { PanError } from '../errors.js'
import { gitPathCommits, gitShowFile } from '../git.js'
import { isRecord, readJson, sha256, writeJsonAtomic } from '../io.js'
import { normalizePolicyInstructions } from '../policy-instructions.js'
import { isSelfDevelopmentInstallation } from '../project-config.js'
import {
  cardSection,
  parseTurnReminderRegistry,
  REFRESH_DIGESTS_COMMAND,
  TURN_REMINDER_CARD_MODES,
  TURN_REMINDER_REGISTRY_PATH,
  turnReminderCardPath,
  type CardSelector,
  type PolicySelector,
  type TurnReminderCardMode,
} from './prompt-context.js'

const POLICY_DIRECTORY = 'governance/policies'

/** Commits of one policy file searched for a pinned instruction's old text. */
export const REFRESH_HISTORY_LIMIT = 200

/** Token Jaccard similarity the chosen instruction must reach. */
export const REFRESH_MIN_SIMILARITY = 0.5

/**
 * Lead the chosen instruction must hold over every other candidate. Within
 * this margin the candidates are contenders, and only the instruction at the
 * pinned text's old position may break the tie.
 */
export const REFRESH_SIMILARITY_MARGIN = 0.1

const CANDIDATE_EXCERPT_LENGTH = 120

export const REFRESH_DIGESTS_SELF_DEVELOPMENT_ONLY =
  `\`${REFRESH_DIGESTS_COMMAND}\` rewrites tracked governance and is ` +
  'available only in self-development.'

export interface RefreshCandidate {
  index: number
  similarity: number
  sha256: string
  excerpt: string
}

export interface RefreshSelectorResult {
  selector_id: string
  profile: string
  type: 'policy' | 'card'
  /** Card mode for a card selector section; absent for a policy selector. */
  mode?: TurnReminderCardMode
  source: string
  status: 'stale' | 'refreshed' | 'refused'
  previous_sha256: string
  /** The digest the selector now pins, or would pin under `--check`. */
  current_sha256: string | null
  /** How a policy selector's replacement was chosen. */
  match?: {
    recovered_from: string
    previous_index: number
    instruction_index: number
    similarity: number
  }
  reason?: string
  candidates?: RefreshCandidate[]
}

export interface RefreshDigestsReport {
  status: 'current' | 'stale' | 'refreshed' | 'refused'
  registry_path: string
  check: boolean
  written: boolean
  selectors_checked: number
  selectors: RefreshSelectorResult[]
  next_action: string | null
}

interface HistoricalInstruction {
  text: string
  index: number
  revision: string
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/gu) ?? [])
}

/** Token Jaccard similarity of two instruction texts, in [0, 1]. */
export function instructionSimilarity(left: string, right: string): number {
  const a = tokens(left)
  const b = tokens(right)

  if (a.size === 0 && b.size === 0) {
    return 1
  }

  let shared = 0

  for (const token of a) {
    if (b.has(token)) {
      shared += 1
    }
  }

  return shared / (a.size + b.size - shared)
}

function excerpt(text: string): string {
  const flat = text.replaceAll(/\s+/gu, ' ').trim()

  return flat.length > CANDIDATE_EXCERPT_LENGTH
    ? `${flat.slice(0, CANDIDATE_EXCERPT_LENGTH - 1)}…`
    : flat
}

function instructionTexts(value: unknown, source: string): string[] | null {
  if (!isRecord(value)) {
    return null
  }

  try {
    return normalizePolicyInstructions(value.instructions, source).map(
      (instruction) => instruction.text,
    )
  } catch {
    return null
  }
}

/** Policy id to its repository-relative file, read from each file's `id`. */
function policyFiles(root: string): Map<string, string> {
  const files = new Map<string, string>()
  const directory = path.join(root, POLICY_DIRECTORY)

  for (const name of readdirSync(directory).sort()) {
    if (!name.endsWith('.json')) {
      continue
    }

    const relative = `${POLICY_DIRECTORY}/${name}`
    const value = readJson(path.join(root, relative))

    if (isRecord(value) && typeof value.id === 'string') {
      files.set(value.id, relative)
    }
  }

  return files
}

/**
 * Find the pinned text in the policy file's history: HEAD first, which covers
 * an uncommitted edit, then every earlier commit that changed the file, up to
 * the bound.
 */
function recoverInstruction(
  root: string,
  relativePath: string,
  digest: string,
  cache: Map<string, Array<{ revision: string; texts: string[] }>>,
): HistoricalInstruction | null {
  let versions = cache.get(relativePath)

  if (!versions) {
    versions = []

    for (const revision of [
      'HEAD',
      ...gitPathCommits(root, relativePath, REFRESH_HISTORY_LIMIT),
    ]) {
      const content = gitShowFile(root, revision, relativePath)

      if (content === null) {
        continue
      }

      let texts: string[] | null = null

      try {
        texts = instructionTexts(JSON.parse(content), relativePath)
      } catch {
        texts = null
      }

      if (texts) {
        versions.push({ revision, texts })
      }
    }

    cache.set(relativePath, versions)
  }

  for (const version of versions) {
    const index = version.texts.findIndex((text) => sha256(text) === digest)

    if (index >= 0) {
      return {
        text: version.texts[index] as string,
        index,
        revision: version.revision,
      }
    }
  }

  return null
}

/**
 * Choose the current instruction an edit of `previous` produced, or explain
 * why no single instruction qualifies.
 */
export function matchEditedInstruction(
  previous: { text: string; index: number },
  current: string[],
):
  | { chosen: RefreshCandidate; candidates: RefreshCandidate[] }
  | { chosen: null; reason: string; candidates: RefreshCandidate[] } {
  const ranked = current
    .map((text, index) => ({
      index,
      similarity: Number(instructionSimilarity(previous.text, text).toFixed(4)),
      sha256: sha256(text),
      excerpt: excerpt(text),
    }))
    .sort(
      (left, right) =>
        right.similarity - left.similarity || left.index - right.index,
    )
  const top = ranked[0]

  if (!top || top.similarity < REFRESH_MIN_SIMILARITY) {
    return {
      chosen: null,
      reason:
        `no current instruction reaches similarity ${REFRESH_MIN_SIMILARITY} ` +
        'with the pinned text, so the instruction was removed or rewritten ' +
        'beyond recognition. Pin the intended instruction by hand or remove ' +
        'the selector.',
      candidates: ranked.slice(0, 3),
    }
  }

  const contenders = ranked.filter(
    (candidate) =>
      candidate.similarity >= REFRESH_MIN_SIMILARITY &&
      top.similarity - candidate.similarity < REFRESH_SIMILARITY_MARGIN,
  )

  if (contenders.length === 1) {
    return { chosen: top, candidates: contenders }
  }

  // Several near-equal matches: the instruction still at the pinned text's
  // old position wins only when no other contender scores higher.
  const samePosition = contenders.find(
    (candidate) => candidate.index === previous.index,
  )

  if (samePosition && samePosition.similarity === top.similarity) {
    return { chosen: samePosition, candidates: contenders }
  }

  return {
    chosen: null,
    reason:
      `${contenders.length} current instructions match the pinned text ` +
      `within ${REFRESH_SIMILARITY_MARGIN} similarity, so the edit is ` +
      'ambiguous. Pin the intended instruction by hand.',
    candidates: contenders,
  }
}

function refreshPolicySelector(
  root: string,
  profile: string,
  selector: PolicySelector,
  currentTexts: Map<string, string[] | null>,
  files: Map<string, string>,
  history: Map<string, Array<{ revision: string; texts: string[] }>>,
): RefreshSelectorResult | null {
  const relativePath = files.get(selector.policy_id)
  const base = {
    selector_id: selector.id,
    profile,
    type: 'policy' as const,
    source: relativePath ?? `${POLICY_DIRECTORY}/${selector.policy_id}.json`,
    previous_sha256: selector.instruction_sha256,
  }

  if (!relativePath) {
    return {
      ...base,
      status: 'refused',
      current_sha256: null,
      reason: `policy '${selector.policy_id}' no longer exists.`,
    }
  }

  if (!currentTexts.has(relativePath)) {
    currentTexts.set(
      relativePath,
      instructionTexts(readJson(path.join(root, relativePath)), relativePath),
    )
  }

  const current = currentTexts.get(relativePath)

  if (!current) {
    return {
      ...base,
      status: 'refused',
      current_sha256: null,
      reason: `${relativePath} does not hold a valid instructions array.`,
    }
  }

  if (current.some((text) => sha256(text) === selector.instruction_sha256)) {
    return null
  }

  const previous = recoverInstruction(
    root,
    relativePath,
    selector.instruction_sha256,
    history,
  )

  if (!previous) {
    return {
      ...base,
      status: 'refused',
      current_sha256: null,
      reason:
        `the pinned text was not found at HEAD or in the last ` +
        `${REFRESH_HISTORY_LIMIT} commits of ${relativePath}, so the edit ` +
        'cannot be traced. Pin the intended instruction by hand.',
    }
  }

  const match = matchEditedInstruction(previous, current)

  if (match.chosen === null) {
    return {
      ...base,
      status: 'refused',
      current_sha256: null,
      reason: match.reason,
      candidates: match.candidates,
    }
  }

  return {
    ...base,
    status: 'stale',
    current_sha256: match.chosen.sha256,
    match: {
      recovered_from: previous.revision,
      previous_index: previous.index,
      instruction_index: match.chosen.index,
      similarity: match.chosen.similarity,
    },
  }
}

function refreshCardSelector(
  root: string,
  profile: string,
  selector: CardSelector,
): RefreshSelectorResult[] {
  const results: RefreshSelectorResult[] = []

  for (const mode of TURN_REMINDER_CARD_MODES) {
    const section = selector.sections[mode]
    const cardPath = turnReminderCardPath(mode)
    const base = {
      selector_id: selector.id,
      profile,
      type: 'card' as const,
      mode,
      source: `${cardPath} · ${section.heading}`,
      previous_sha256: section.content_sha256,
    }
    let digest: string

    try {
      digest = sha256(cardSection(root, cardPath, section.heading))
    } catch (error) {
      results.push({
        ...base,
        status: 'refused',
        current_sha256: null,
        reason:
          `${error instanceof Error ? error.message : String(error)} ` +
          'Restore the heading or repin the selector by hand.',
      })
      continue
    }

    if (digest !== section.content_sha256) {
      results.push({ ...base, status: 'stale', current_sha256: digest })
    }
  }

  return results
}

/**
 * Report, and unless `check` is set rewrite, every stale pinned digest in the
 * turn reminder registry. The write is all or nothing: one refused selector
 * leaves the registry untouched, so a partial repair never hides the refusal.
 */
export function refreshGovernanceDigests(
  root: string,
  options: { check?: boolean } = {},
): RefreshDigestsReport {
  if (!isSelfDevelopmentInstallation(root)) {
    throw new PanError(REFRESH_DIGESTS_SELF_DEVELOPMENT_ONLY, {
      code: 'REFRESH_DIGESTS_SELF_DEVELOPMENT_ONLY',
    })
  }

  const check = options.check === true
  const registryPath = path.join(root, TURN_REMINDER_REGISTRY_PATH)
  const raw = readJson(registryPath)
  const registry = parseTurnReminderRegistry(raw)
  const files = policyFiles(root)
  const currentTexts = new Map<string, string[] | null>()
  const history = new Map<
    string,
    Array<{ revision: string; texts: string[] }>
  >()
  const results: RefreshSelectorResult[] = []
  let checked = 0

  for (const [profile, definition] of Object.entries(registry.profiles)) {
    for (const selector of definition.selectors) {
      checked += 1

      if (selector.type === 'card') {
        results.push(...refreshCardSelector(root, profile, selector))
        continue
      }

      const result = refreshPolicySelector(
        root,
        profile,
        selector,
        currentTexts,
        files,
        history,
      )

      if (result) {
        results.push(result)
      }
    }
  }

  const refused = results.some((result) => result.status === 'refused')
  const stale = results.length > 0
  const written = stale && !refused && !check

  if (written) {
    applyRefresh(raw, results)
    writeJsonAtomic(registryPath, raw)

    for (const result of results) {
      result.status = 'refreshed'
    }
  }

  return {
    status: refused
      ? 'refused'
      : !stale
        ? 'current'
        : written
          ? 'refreshed'
          : 'stale',
    registry_path: TURN_REMINDER_REGISTRY_PATH,
    check,
    written,
    selectors_checked: checked,
    selectors: results,
    next_action: refused
      ? 'Resolve each refused selector by hand, then rerun ' +
        `\`${REFRESH_DIGESTS_COMMAND}\`.`
      : stale && check
        ? `Run \`${REFRESH_DIGESTS_COMMAND}\` to rewrite the stale digests.`
        : null,
  }
}

/** Rewrite the stale digests in the raw registry, keeping its key order. */
function applyRefresh(raw: unknown, results: RefreshSelectorResult[]): void {
  if (!isRecord(raw) || !isRecord(raw.profiles)) {
    return
  }

  for (const result of results) {
    const profile = raw.profiles[result.profile]
    const selectors =
      isRecord(profile) && Array.isArray(profile.selectors)
        ? profile.selectors
        : []
    const selector = selectors.find(
      (candidate: unknown) =>
        isRecord(candidate) && candidate.id === result.selector_id,
    ) as Record<string, unknown> | undefined

    if (!selector || result.current_sha256 === null) {
      continue
    }

    if (result.type === 'policy') {
      selector.instruction_sha256 = result.current_sha256
      continue
    }

    const sections = isRecord(selector.sections) ? selector.sections : {}
    const section = result.mode ? sections[result.mode] : undefined

    if (isRecord(section)) {
      section.content_sha256 = result.current_sha256
    }
  }
}

/** One line per stale or refused selector, for a reader without `--json`. */
export function renderRefreshDigestsReport(
  report: RefreshDigestsReport,
): string {
  const lines = [
    report.status === 'current'
      ? `current: all ${report.selectors_checked} selector(s) in ` +
        `${report.registry_path} match their sources.`
      : `${report.status}: ${report.selectors.length} digest(s) of ` +
        `${report.selectors_checked} selector(s) in ${report.registry_path} ` +
        (report.written ? 'rewritten.' : 'need attention; nothing written.'),
  ]

  for (const result of report.selectors) {
    const where = result.mode ? ` [${result.mode}]` : ''

    lines.push(
      `- ${result.status} ${result.profile}/${result.selector_id}${where} ` +
        `(${result.source}): ${result.previous_sha256} -> ` +
        `${result.current_sha256 ?? 'unresolved'}` +
        (result.match
          ? ` (instruction ${result.match.instruction_index}, ` +
            `similarity ${result.match.similarity}, old text from ` +
            `${result.match.recovered_from})`
          : ''),
    )

    if (result.reason) {
      lines.push(`  reason: ${result.reason}`)
    }

    for (const candidate of result.candidates ?? []) {
      lines.push(
        `  candidate instruction ${candidate.index} ` +
          `(similarity ${candidate.similarity}, sha256 ${candidate.sha256}): ` +
          candidate.excerpt,
      )
    }
  }

  if (report.next_action) {
    lines.push(`next: ${report.next_action}`)
  }

  return `${lines.join('\n')}\n`
}
