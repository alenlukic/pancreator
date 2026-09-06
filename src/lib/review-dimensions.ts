import path from 'node:path'

import { PanError } from './errors.js'
import { fileExists } from './io.js'

/**
 * Which lineup a dimension belongs to in `library/skills/review-squad.md`:
 *
 * - `core`: runs on every product review.
 * - `conditional`: runs when the diff touches its surface.
 * - `harness`: the lineup that replaces the core one when the review target is
 *   the Pancreator harness itself. Its charters live in
 *   `library/skills/review-squad-pancreator.md`, which a target installation
 *   never carries.
 */
export type ReviewDimensionLineup = 'core' | 'conditional' | 'harness'

export interface ReviewDimension {
  /** Operator-facing identifier accepted by `--dimensions`. */
  slug: string
  lineup: ReviewDimensionLineup
  /** Skill file that defines the charter. */
  charter_path: string
  /** Level-three heading of the charter inside `charter_path`. */
  charter_heading: string
}

export const CORE_SQUAD_SKILL_PATH = 'library/skills/review-squad.md'
export const HARNESS_SQUAD_SKILL_PATH =
  'library/skills/review-squad-pancreator.md'

/**
 * The slug set the harness accepts. The charters themselves stay in the skill
 * files, which are canonical for what each dimension reviews. This table only
 * names them so a selection can be refused before any worker launches.
 */
export const REVIEW_DIMENSIONS: readonly ReviewDimension[] = [
  {
    slug: 'correctness',
    lineup: 'core',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Correctness',
  },
  {
    slug: 'security',
    lineup: 'core',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Security',
  },
  {
    slug: 'architecture',
    lineup: 'core',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Architecture',
  },
  {
    slug: 'simplification',
    lineup: 'core',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Simplification',
  },
  {
    slug: 'operations',
    lineup: 'core',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Operations',
  },
  {
    slug: 'frontend',
    lineup: 'conditional',
    charter_path: CORE_SQUAD_SKILL_PATH,
    charter_heading: 'Frontend',
  },
  {
    slug: 'correctness-consistency',
    lineup: 'harness',
    charter_path: HARNESS_SQUAD_SKILL_PATH,
    charter_heading: 'Correctness & consistency',
  },
  {
    slug: 'agentic-practice',
    lineup: 'harness',
    charter_path: HARNESS_SQUAD_SKILL_PATH,
    charter_heading: 'Agentic practice',
  },
  {
    slug: 'performance',
    lineup: 'harness',
    charter_path: HARNESS_SQUAD_SKILL_PATH,
    charter_heading: 'Performance',
  },
]

/** Slug derived from a charter heading, so a test can cross-check the table. */
export function reviewDimensionSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/&/gu, ' ')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
}

/** True when the harness lineup file ships in this installation. */
export function harnessLineupPresent(root: string): boolean {
  return fileExists(path.join(root, HARNESS_SQUAD_SKILL_PATH))
}

/**
 * Dimensions an operator can select here. The harness lineup is selectable
 * only where its charters exist, so a target installation never accepts a
 * slug whose charter no agent can read.
 */
export function availableReviewDimensions(root: string): ReviewDimension[] {
  const harness = harnessLineupPresent(root)

  return REVIEW_DIMENSIONS.filter(
    (dimension) => harness || dimension.lineup !== 'harness',
  )
}

/**
 * The lineup the squad always runs when the operator selects nothing. Where
 * the harness lineup ships, the review target is the harness and the skill
 * swaps to those three dimensions. Elsewhere the core lineup applies. The
 * conditional dimensions are not part of it: the coordinator resolves them
 * against the diff, so listing them here would report them as run, or as left
 * out, when neither was decided yet.
 */
export function defaultReviewLineup(root: string): ReviewDimension[] {
  const harness = harnessLineupPresent(root)

  return REVIEW_DIMENSIONS.filter((dimension) =>
    harness ? dimension.lineup === 'harness' : dimension.lineup === 'core',
  )
}

/**
 * Dimensions the coordinator activates only when the diff touches their
 * surface. They accompany the core lineup; the harness lineup, which reviews
 * the harness itself, carries none.
 */
export function conditionalReviewDimensions(root: string): ReviewDimension[] {
  return harnessLineupPresent(root)
    ? []
    : REVIEW_DIMENSIONS.filter(
        (dimension) => dimension.lineup === 'conditional',
      )
}

export interface ReviewDimensionSelection {
  /** True when the operator named no dimension and the default lineup runs. */
  default: boolean
  /** Slugs the squad runs, in canonical order. */
  selected: string[]
  /**
   * Default-lineup slugs the selection leaves out. Empty for a default run.
   * Conditional dimensions never appear here: the operator did not leave them
   * out, the coordinator decides them.
   */
  not_run: string[]
  /**
   * Conditional slugs the coordinator resolves against the diff, in canonical
   * order, less any the operator selected outright.
   */
  conditional: string[]
  /** Every slug this installation accepts, in canonical order. */
  available: string[]
}

/**
 * Resolve an operator dimension selection against the canonical table.
 *
 * An unknown slug is refused with the accepted list, so a typo fails at the
 * card step rather than after the fan-out. Duplicates collapse and the result
 * keeps canonical order, so two spellings of the same selection render the
 * same card.
 */
export function resolveReviewDimensionSelection(
  root: string,
  requested: readonly string[],
): ReviewDimensionSelection {
  const available = availableReviewDimensions(root)
  const availableSlugs = available.map((dimension) => dimension.slug)
  const cleaned = [
    ...new Set(requested.map((item) => item.trim()).filter(Boolean)),
  ]
  const conditional = conditionalReviewDimensions(root).map(
    (dimension) => dimension.slug,
  )

  if (cleaned.length === 0) {
    return {
      default: true,
      selected: defaultReviewLineup(root).map((dimension) => dimension.slug),
      not_run: [],
      conditional,
      available: availableSlugs,
    }
  }

  const unknown = cleaned.filter((slug) => !availableSlugs.includes(slug))

  if (unknown.length > 0) {
    throw new PanError(
      `Unknown review dimension${unknown.length > 1 ? 's' : ''}: ` +
        `${unknown.join(', ')}. Accepted dimensions: ` +
        `${availableSlugs.join(', ')}.`,
      { code: 'UNKNOWN_REVIEW_DIMENSION' },
    )
  }

  const selected = availableSlugs.filter((slug) => cleaned.includes(slug))
  const notRun = defaultReviewLineup(root)
    .map((dimension) => dimension.slug)
    .filter((slug) => !selected.includes(slug))

  return {
    default: false,
    selected,
    not_run: notRun,
    conditional: conditional.filter((slug) => !selected.includes(slug)),
    available: availableSlugs,
  }
}
