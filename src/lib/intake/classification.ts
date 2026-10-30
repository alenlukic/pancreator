import { invariant } from '../errors.js'

export const SIZE_CLASSES = ['XS', 'S', 'M', 'L', 'XL'] as const

export type SizeClass = (typeof SIZE_CLASSES)[number]

export interface SizeThreshold {
  sizeClass: Exclude<SizeClass, 'XL'>
  slocTarget: number
  tssrfTarget: number
  moduleTarget: number
  slocHardMax: number
}

/** The rubric `governance/handbooks/eng/sizing.md` states. XL has no bound. */
export const SIZE_RUBRIC: readonly SizeThreshold[] = [
  {
    sizeClass: 'XS',
    slocTarget: 25,
    tssrfTarget: 1,
    moduleTarget: 1,
    slocHardMax: 50,
  },
  {
    sizeClass: 'S',
    slocTarget: 150,
    tssrfTarget: 2,
    moduleTarget: 2,
    slocHardMax: 300,
  },
  {
    sizeClass: 'M',
    slocTarget: 600,
    tssrfTarget: 8,
    moduleTarget: 6,
    slocHardMax: 1000,
  },
  {
    sizeClass: 'L',
    slocTarget: 1200,
    tssrfTarget: 16,
    moduleTarget: 12,
    slocHardMax: 2000,
  },
]

export const TARGET_LAYERS = ['frontend', 'api', 'backend'] as const

export const SELF_DEVELOPMENT_LAYERS = [
  'cli-engine',
  'governance',
  'library',
  'host-projections',
] as const

export const ROUTE_STEPS = [
  'one-shot',
  'standard',
  'prototype-trace',
  'decompose',
] as const

export type RouteStep = (typeof ROUTE_STEPS)[number]

export interface IntakeEstimate {
  sloc: number
  tssrfs: number
  modules: number
  layers: readonly string[]
  newIntegrationPoints: boolean
}

export interface IntakeClassification {
  sizeClass: SizeClass
  integration: boolean
  newIntegrationPoints: boolean
  route: RouteStep[]
}

/**
 * Smallest class whose target the estimate meets, on SLOC alone or on the
 * TSSRF and module counts together, and whose SLOC hard max it stays within.
 */
export function sizeClassFor(
  estimate: Pick<IntakeEstimate, 'sloc' | 'tssrfs' | 'modules'>,
): SizeClass {
  for (const threshold of SIZE_RUBRIC) {
    const meetsTarget =
      estimate.sloc <= threshold.slocTarget ||
      (estimate.tssrfs <= threshold.tssrfTarget &&
        estimate.modules <= threshold.moduleTarget)

    if (meetsTarget && estimate.sloc <= threshold.slocHardMax) {
      return threshold.sizeClass
    }
  }

  return 'XL'
}

/** Ordered route steps for a size class, per the sizing handbook's route table. */
export function routeFor(
  sizeClass: SizeClass,
  newIntegrationPoints: boolean,
): RouteStep[] {
  if (sizeClass === 'XS' || sizeClass === 'S') {
    return ['one-shot']
  }

  const followUp: RouteStep = sizeClass === 'M' ? 'standard' : 'decompose'

  return newIntegrationPoints ? ['prototype-trace', followUp] : [followUp]
}

/**
 * Validates an estimate against the installation's layer vocabulary and
 * derives its size class, integration flags, and route.
 */
export function classifyIntake(
  estimate: IntakeEstimate,
  layerVocabulary: readonly string[],
): IntakeClassification {
  for (const [name, value] of [
    ['sloc', estimate.sloc],
    ['tssrfs', estimate.tssrfs],
    ['modules', estimate.modules],
  ] as const) {
    invariant(
      Number.isInteger(value) && value >= 0,
      `Intake estimate ${name} must be a non-negative integer; received ${value}.`,
      { code: 'INVALID_INTAKE_ESTIMATE' },
    )
  }

  const layers = [...new Set(estimate.layers)]

  invariant(
    layers.length > 0,
    'Intake estimate must name at least one layer.',
    {
      code: 'INVALID_INTAKE_ESTIMATE',
    },
  )

  const unknown = layers.filter((layer) => !layerVocabulary.includes(layer))

  invariant(
    unknown.length === 0,
    `Unknown intake layer ${unknown.join(', ')}; expected one of ${layerVocabulary.join(', ')}.`,
    { code: 'INVALID_INTAKE_LAYER' },
  )

  const integration = layers.length > 1

  invariant(
    integration || !estimate.newIntegrationPoints,
    'A new integration point needs at least two layers.',
    { code: 'INVALID_INTAKE_ESTIMATE' },
  )

  const sizeClass = sizeClassFor(estimate)

  return {
    sizeClass,
    integration,
    newIntegrationPoints: estimate.newIntegrationPoints,
    route: routeFor(sizeClass, estimate.newIntegrationPoints),
  }
}
