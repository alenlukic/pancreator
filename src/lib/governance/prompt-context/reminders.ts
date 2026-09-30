/**
 * Selector resolution against policies and card sections, the rendered turn
 * reminder with its pinned digests, and the profile validation repository
 * checks run.
 */

import path from 'node:path'

import { readText, sha256, fileExists } from '../../io.js'
import { loadPolicyCatalog } from '../../policies.js'
import { loadProjectConfig } from '../../project-config.js'
import type { Policy, RunState } from '../../types.js'
import {
  CARD_MODE_TEMPLATES,
  CARD_PATH,
  REFRESH_DIGESTS_COMMAND,
  TURN_REMINDER_ROLES,
  invalid,
  loadTurnReminderRegistry,
  resolveProfileSelectors,
  type CardSelector,
  type TurnReminderCardMode,
  type TurnReminderRegistry,
  type TurnReminderRole,
  type TurnReminderSelector,
} from './registry.js'
import { activeCard, fallbackCard, liveRuns, type ActiveCard } from './cards.js'

export interface ResolvedReminderLine {
  selector_id: string
  source: string
  content: string
}

export interface RenderedTurnReminder {
  role: Exclude<TurnReminderRole, 'none'>
  profile: string
  lines: ResolvedReminderLine[]
  card: ActiveCard
  content: string
  byte_length: number
}

/**
 * Return the trimmed text of a Markdown section in a card file, from the exact
 * `heading` line up to the next heading of the same or higher level. Throws
 * through `invalid` when the heading is absent.
 */
export function cardSection(
  root: string,
  cardPath: string,
  heading: string,
): string {
  const lines = readText(path.join(root, cardPath)).trim().split('\n')
  const start = lines.findIndex((line) => line.trimEnd() === heading)

  if (start < 0) {
    invalid(`card selector heading '${heading}' was not found in ${cardPath}.`)
  }

  const depth = heading.match(/^#+/u)?.[0].length ?? 0
  let end = lines.length

  for (let index = start + 1; index < lines.length; index += 1) {
    const match = /^(#{1,6}) /u.exec(lines[index] ?? '')

    if (match && match[1].length <= depth) {
      end = index
      break
    }
  }

  return lines.slice(start, end).join('\n').trim()
}

function resolveCardSelector(
  root: string,
  cardPath: string,
  selector: CardSelector,
  cardMode: TurnReminderCardMode,
): ResolvedReminderLine {
  const section = selector.sections[cardMode]
  const content = cardSection(root, cardPath, section.heading)
  const digest = sha256(content)

  if (digest !== section.content_sha256) {
    invalid(
      `card selector '${selector.id}' for '${section.heading}' in ` +
        `${cardPath} is stale: expected ${section.content_sha256}, ` +
        `received ${digest}. Run \`${REFRESH_DIGESTS_COMMAND}\` to rewrite ` +
        'the pinned digest.',
    )
  }

  return {
    selector_id: selector.id,
    source: `${cardPath} · ${section.heading}`,
    content,
  }
}

function resolveSelector(
  root: string,
  catalog: Map<string, Policy>,
  selector: TurnReminderSelector,
  cardMode: TurnReminderCardMode,
): ResolvedReminderLine {
  if (selector.type === 'card') {
    return resolveCardSelector(root, CARD_PATH, selector, cardMode)
  }

  const policy = catalog.get(selector.policy_id)

  if (!policy) {
    invalid(
      `policy selector '${selector.id}' references missing policy ` +
        `'${selector.policy_id}'.`,
    )
  }

  const instruction = policy.instructions.find(
    (candidate) => sha256(candidate.text) === selector.instruction_sha256,
  )

  if (!instruction) {
    invalid(
      `policy selector '${selector.id}' for '${selector.policy_id}' is stale: ` +
        `no instruction has digest ${selector.instruction_sha256}. Run ` +
        `\`${REFRESH_DIGESTS_COMMAND}\` to rewrite the pinned digest.`,
    )
  }

  return {
    selector_id: selector.id,
    source: selector.policy_id,
    content: instruction.text,
  }
}

/**
 * Return the card mode for reminder card selectors from the project config:
 * `embedded`, `detached`, or `self_development` for every other installation
 * mode.
 */
export function installationCardMode(root: string): TurnReminderCardMode {
  const mode = loadProjectConfig(root).installation_mode

  return mode === 'embedded' || mode === 'detached' ? mode : 'self_development'
}

/**
 * Resolve every selector of a profile to its reminder line: the pinned policy
 * instruction or card section text with its source label. Throws through
 * `invalid` when a referenced policy is missing or a pinned digest no longer
 * matches, naming `pan governance refresh-digests` as the repair.
 */
export function resolveTurnReminderLines(
  root: string,
  profileId: string,
  registry = loadTurnReminderRegistry(root),
  cardMode = installationCardMode(root),
): ResolvedReminderLine[] {
  const catalog = loadPolicyCatalog(root)

  return resolveProfileSelectors(registry, profileId).map((selector) =>
    resolveSelector(root, catalog, selector, cardMode),
  )
}

function renderReminderContent(
  role: Exclude<TurnReminderRole, 'none'>,
  profile: string,
  lines: ResolvedReminderLine[],
  card: ActiveCard,
): string {
  const groups = new Map<string, string[]>()

  for (const line of lines) {
    const group = groups.get(line.source) ?? []
    group.push(line.content)
    groups.set(line.source, group)
  }

  const sections = [...groups.entries()].flatMap(([source, contents]) => [
    `[${source}]`,
    ...contents,
    '',
  ])

  return [
    'Pancreator governance reminder',
    `Role: ${role}`,
    `Profile: ${profile}`,
    '',
    ...sections,
    `Active card: ${card.path} (sha256:${card.sha256})`,
  ].join('\n')
}

/**
 * Render the governance reminder text for a role: its profile's resolved lines
 * grouped by source, followed by the active card path and digest. Throws
 * through `invalid` when the role has no profile, a selector is stale, or the
 * rendered bytes exceed the registry's `byte_budget`.
 */
export function renderTurnReminder(
  root: string,
  role: Exclude<TurnReminderRole, 'none'>,
  options: {
    mode?: string | null
    card?: ActiveCard
    registry?: TurnReminderRegistry
    liveRuns?: RunState[]
  } = {},
): RenderedTurnReminder {
  const registry = options.registry ?? loadTurnReminderRegistry(root)
  const profile = registry.roles[role]

  if (profile === null) {
    invalid(`role '${role}' does not declare a reminder profile.`)
  }

  const lines = resolveTurnReminderLines(root, profile, registry)
  const card =
    options.card ??
    activeCard(
      root,
      role,
      options.mode ?? null,
      options.liveRuns ?? liveRuns(root),
    )
  const content = renderReminderContent(role, profile, lines, card)
  const byteLength = Buffer.byteLength(content, 'utf8')

  if (byteLength > registry.byte_budget) {
    invalid(
      `profile '${profile}' for role '${role}' renders ${byteLength} bytes, ` +
        `over the ${registry.byte_budget}-byte budget.`,
    )
  }

  return {
    role,
    profile,
    lines,
    card,
    content,
    byte_length: byteLength,
  }
}

function validateCardModeTemplates(
  root: string,
  registry: TurnReminderRegistry,
): string[] {
  const errors: string[] = []
  const selectors = new Map<string, CardSelector>()

  for (const profile of Object.values(registry.profiles)) {
    for (const selector of profile.selectors) {
      if (selector.type === 'card') {
        selectors.set(selector.id, selector)
      }
    }
  }

  for (const selector of selectors.values()) {
    for (const [mode, cardPath] of Object.entries(CARD_MODE_TEMPLATES) as Array<
      [TurnReminderCardMode, string]
    >) {
      if (!fileExists(path.join(root, cardPath))) {
        continue
      }

      try {
        resolveCardSelector(root, cardPath, selector, mode)
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
  }

  return errors
}

/**
 * Check that every role's reminder renders within budget and that every card
 * selector matches each installer card template present. Returns the distinct
 * error messages, empty when all profiles are valid; never throws.
 */
export function validateTurnReminderProfiles(root: string): string[] {
  try {
    const registry = loadTurnReminderRegistry(root)
    const errors: string[] = []
    const card = fallbackCard(root)

    for (const role of TURN_REMINDER_ROLES) {
      if (role === 'none') {
        continue
      }

      try {
        renderTurnReminder(root, role, {
          card,
          registry,
          liveRuns: [],
        })
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    errors.push(...validateCardModeTemplates(root, registry))

    return [...new Set(errors)]
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}
