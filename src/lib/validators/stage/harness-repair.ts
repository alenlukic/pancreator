/** The harness-repair intake Markdown validator. */

import path from 'node:path'

import { fileExists, readText } from '../../io.js'
import {
  loadHarnessRepairCategories,
  type HarnessRepairCategory,
} from '../../governance/harness-repair-categories.js'
import {
  operatorLead,
  parseMarkdown,
  hasHeading,
  operatorLeadPresent,
} from '../../markdown.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { inboxTemporalScanDirectories } from '../../inbox.js'
import { readProjectConfig } from '../../project-config.js'
import { issue } from './evidence.js'

const HARNESS_REPAIR_CLASSIFICATIONS = [
  'harness bug',
  'compliance issue',
  'governance miss',
  'agent execution error',
  'target-repository defect',
  'unresolved hypothesis',
] as const

/** Body of a `##` section, from its heading to the next `##` heading. */
function topLevelSection(content: string, heading: RegExp): string {
  const match = heading.exec(content)

  if (!match) {
    return ''
  }

  const remainder = content.slice((match.index ?? 0) + match[0].length)
  const next = /^##\s+/mu.exec(remainder)

  return remainder.slice(0, next?.index)
}

const REPAIR_CATEGORY_LINE = /^\*\*Category:\*\*\s*(.+?)\s*\(`([^`]+)`\)\s*$/mu

/**
 * Category the intake declares in its operator lead. The lead is the region
 * `operatorLeadPresent` already reads, so a declaration below it does not
 * count as a lead field.
 */
function declaredRepairCategory(
  content: string,
): { displayName: string; slug: string } | null {
  const match = REPAIR_CATEGORY_LINE.exec(operatorLead(content))

  return match ? { displayName: match[1], slug: match[2] } : null
}

/** True when a hyphen-delimited run of the basename is exactly the slug. */
function basenameCarriesSlug(basename: string, slug: string): boolean {
  return new RegExp(`(?:^|-)${slug}(?:-|$)`, 'u').test(basename)
}

const SIBLING_INTAKE_PATTERN =
  /\bharness-repair-\d{8}T\d{6}Z-[a-z0-9-]+\.md\b/gu

/**
 * An intake cites a sibling by file name alone, and the sibling may sit in any
 * inbox status of this checkout or of a registered installation, because a
 * consolidated sweep names the items it read in each installation's queue.
 */
function inboxRootsForSiblingIntakes(root: string): string[] {
  const roots = [root]

  try {
    for (const installation of readProjectConfig(root)?.installations ?? []) {
      roots.push(installation.path)
    }
  } catch {
    // An unreadable configuration is another validator's finding; the
    // sibling check then resolves against this checkout alone.
  }

  return roots
}

function inboxHoldsFile(root: string, fileName: string): boolean {
  const directories = ['runtime/inbox', ...inboxTemporalScanDirectories()]

  return directories.some((directory) =>
    fileExists(path.join(root, directory, fileName)),
  )
}

function unresolvedSiblingIntakes(
  root: string,
  targetPath: string,
  content: string,
): string[] {
  const ownName = path.basename(targetPath)
  const roots = inboxRootsForSiblingIntakes(root)
  const unresolved = new Set<string>()

  for (const match of content.matchAll(SIBLING_INTAKE_PATTERN)) {
    const name = match[0]

    if (
      name !== ownName &&
      !roots.some((inboxRoot) => inboxHoldsFile(inboxRoot, name))
    ) {
      unresolved.add(name)
    }
  }

  return [...unresolved]
}

export function validateHarnessRepairIntake(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const lower = content.toLowerCase()
  const parsed = parseMarkdown(content)

  const categories = loadHarnessRepairCategories(input.root)
  const requiredHeadings = [
    'original report',
    'investigation scope',
    'evidence examined',
    'agent transcript coverage',
    'execution timeline',
    'findings',
    'root-cause remediation',
    'acceptance criteria',
    'validation plan',
    'installation and migration impact',
    'constraints and out of scope',
    'open questions and unknowns',
    'recommended next action',
  ]

  if (!hasHeading(parsed, 'harness repair intake', 1)) {
    issues.push(
      issue(
        'repair.title',
        'Harness repair intake MUST begin with # Harness repair intake',
      ),
    )
  }

  if (
    !operatorLeadPresent(content) ||
    !lower.slice(0, 700).includes('blocker')
  ) {
    issues.push(
      issue(
        'repair.operator_lead',
        'Harness repair intake MUST lead with State, Outcome, Blockers, and Next action',
      ),
    )
  }

  const declaredCategory = declaredRepairCategory(content)
  let category: HarnessRepairCategory | undefined

  if (!declaredCategory) {
    issues.push(
      issue(
        'repair.category_missing',
        'Harness repair intake MUST declare its category in the operator lead ' +
          'as **Category:** <display name> (`<slug>`)',
      ),
    )
  } else {
    category = categories.find((entry) => entry.slug === declaredCategory.slug)

    if (!category) {
      issues.push(
        issue(
          'repair.category_unknown',
          `Harness repair category '${declaredCategory.slug}' is not declared in the category registry`,
        ),
      )
    } else if (
      category.display_name.toLowerCase() !==
      declaredCategory.displayName.toLowerCase()
    ) {
      issues.push(
        issue(
          'repair.category_display_name',
          `Harness repair category '${category.slug}' MUST use display name ${category.display_name}`,
        ),
      )
    }
  }

  const basename = path.basename(input.targetPath, '.md')

  if (category && basename.startsWith('harness-repair-')) {
    const carried = categories.filter((entry) =>
      basenameCarriesSlug(basename, entry.slug),
    )

    if (
      carried.length > 0 &&
      !carried.some((entry) => entry.slug === category.slug)
    ) {
      issues.push(
        issue(
          'repair.category_filename',
          `${basename} carries category slug '${carried[0].slug}' but the intake declares '${category.slug}'`,
        ),
      )
    }
  }

  for (const name of unresolvedSiblingIntakes(
    input.root,
    input.targetPath,
    content,
  )) {
    issues.push(
      issue(
        'repair.sibling_reference',
        `Intake names sibling intake '${name}', which no inbox of this checkout or of a registered installation holds`,
      ),
    )
  }

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'repair.section_missing',
          `Harness repair intake MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const findingMatches = [...content.matchAll(/^#{3,6}\s+(HR-\d{3})\b.*$/gmu)]
  const findingIds = findingMatches.map((match) => match[1])

  if (findingIds.length === 0) {
    issues.push(
      issue(
        'repair.finding_id',
        'Harness repair intake MUST include at least one stable HR-### finding id',
      ),
    )
  } else if (new Set(findingIds).size !== findingIds.length) {
    issues.push(
      issue(
        'repair.finding_id_duplicate',
        'Harness repair finding ids MUST be unique',
      ),
    )
  }

  for (const [index, match] of findingMatches.entries()) {
    const start = match.index ?? 0
    const nextFinding = findingMatches[index + 1]?.index ?? content.length
    const remainder = content.slice(start, nextFinding)

    const nextTopLevelSection = /^##\s+/mu.exec(
      remainder.slice(match[0].length),
    )
    const end = nextTopLevelSection
      ? start + match[0].length + nextTopLevelSection.index
      : nextFinding

    const block = content.slice(start, Math.min(end, nextFinding))
    const blockLower = block.toLowerCase()
    const findingId = match[1]

    if (
      !HARNESS_REPAIR_CLASSIFICATIONS.some((classification) =>
        blockLower.includes(`classification:** ${classification}`),
      )
    ) {
      issues.push(
        issue(
          'repair.classification',
          `${findingId} MUST classify the finding as a harness bug, compliance issue, governance miss, agent execution error, target-repository defect, or unresolved hypothesis`,
        ),
      )
    }

    for (const label of [
      'severity',
      'evidence',
      'expected contract',
      'causal chain',
      'root cause',
      'affected surfaces',
    ]) {
      if (!blockLower.includes(`**${label}:**`)) {
        issues.push(
          issue('repair.finding_field', `${findingId} MUST include ${label}`),
        )
      }
    }
  }

  const remediationSection = topLevelSection(
    content,
    /^##\s+Root-cause remediation\s*$/imu,
  )

  for (const findingId of findingIds) {
    if (!remediationSection.includes(findingId)) {
      issues.push(
        issue(
          'repair.remediation_traceability',
          `Root-cause remediation MUST name ${findingId}`,
        ),
      )
    }
  }

  const acceptanceSection = topLevelSection(
    content,
    /^##\s+Acceptance criteria\s*$/imu,
  )
  const criterionMatches = [
    ...acceptanceSection.matchAll(/^\s*\d+\.\s+(AC-\d{3})\b(.*)$/gmu),
  ]
  const criterionIds = criterionMatches.map((match) => match[1])

  if (findingIds.length > 0) {
    for (const match of criterionMatches) {
      if (!findingIds.some((findingId) => match[2].includes(findingId))) {
        issues.push(
          issue(
            'repair.acceptance_traceability',
            `${match[1]} MUST name the HR-### finding it satisfies`,
          ),
        )
      }
    }
  }

  if (criterionIds.length === 0) {
    issues.push(
      issue(
        'repair.acceptance_id',
        'Harness repair intake MUST include stable AC-### acceptance criteria',
      ),
    )
  } else if (new Set(criterionIds).size !== criterionIds.length) {
    issues.push(
      issue(
        'repair.acceptance_id_duplicate',
        'Harness repair acceptance criterion ids MUST be unique',
      ),
    )
  }

  if (!/^\s*\d+\.\s+AC-\d{3}\b/gmu.test(acceptanceSection)) {
    issues.push(
      issue(
        'repair.numbered_acceptance',
        'Acceptance criteria MUST be numbered and begin with stable AC-### ids',
      ),
    )
  }

  const transcriptSection = topLevelSection(
    content,
    /^##\s+Agent transcript coverage\s*$/imu,
  )
  const transcriptLower = transcriptSection.toLowerCase()
  const transcriptStatusPresent =
    transcriptLower.includes('examined') ||
    transcriptLower.includes('unavailable') ||
    transcriptLower.includes('not applicable')

  if (!transcriptStatusPresent) {
    issues.push(
      issue(
        'repair.transcript_coverage',
        'Agent transcript coverage MUST mark transcript evidence as examined, unavailable, or not applicable',
      ),
    )
  }

  if (
    !transcriptLower.includes('delegation') ||
    !transcriptLower.includes('transcript')
  ) {
    issues.push(
      issue(
        'repair.transcript_distinction',
        'Harness repair intake MUST distinguish delegation evidence from agent transcripts',
      ),
    )
  }

  // The next-action route belongs to the category, because an out-of-band
  // intake cannot honestly recommend a workflow run. An unresolved category
  // already fails the document, so no route is assumed for it.
  if (category) {
    const nextActionSection = topLevelSection(
      content,
      /^##\s+Recommended next action\s*$/imu,
    ).toLowerCase()
    // The required tokens stay scoped to the section that owns the full
    // contract: the lead is a summary, so requiring them there is over-strict.
    // A forbidden token is refused wherever a reader can act on it, and the
    // lead's next-action field is the first one a reader acts on.
    const forbiddenRegions: Array<{ label: string; text: string }> = [
      { label: 'Recommended next action', text: nextActionSection },
      { label: 'operator lead', text: operatorLead(content).toLowerCase() },
    ]

    for (const token of category.next_action_contract.required_tokens) {
      if (!nextActionSection.includes(token.toLowerCase())) {
        issues.push(
          issue(
            'repair.next_action',
            `Recommended next action for the ${category.display_name} category MUST name ${token}`,
          ),
        )
      }
    }

    for (const token of category.next_action_contract.forbidden_tokens) {
      for (const region of forbiddenRegions) {
        if (region.text.includes(token.toLowerCase())) {
          issues.push(
            issue(
              'repair.next_action_forbidden',
              `The ${region.label} of a ${category.display_name} intake MUST NOT recommend ${token}`,
            ),
          )
        }
      }
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
