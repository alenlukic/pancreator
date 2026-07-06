import path from 'node:path'

import { invariant } from './errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import { OPERATOR_ARTIFACT_PROFILE_HEADINGS } from './operator-artifact-profiles.js'
import { configuredWorkspaceRoot } from './project-config.js'

const COMMON_REGISTRY_PATH = 'library/operator-briefs/primitives.json'
const BASE_CSS_PATH = 'library/operator-briefs/base.css'
const PROJECT_REGISTRY_PATH = 'docs/operator-briefs/project.json'
const PROJECT_CSS_PATH = 'docs/operator-briefs/project.css'
const PROJECT_REGISTRY_TEMPLATE =
  'library/templates/operator-briefs/project.json'
const PROJECT_CSS_TEMPLATE = 'library/templates/operator-briefs/project.css'

interface BriefDefinition {
  label: string
  description: string
}

interface SectionSemantic extends BriefDefinition {
  emoji: string
}

interface CardType extends BriefDefinition {
  layout: 'standard' | 'split-header'
  required_fields?: string[]
}

interface BriefRegistry {
  schema_version: 1
  brief_types: Record<string, BriefDefinition>
  section_semantics: Record<string, SectionSemantic>
  card_types: Record<string, CardType>
  field_semantics: Record<string, BriefDefinition>
}

interface ProjectBriefRegistry extends BriefRegistry {
  status: 'ready'
  project: { id: string; title: string }
  extends: 'pancreator'
}

interface BriefStatus {
  label: string
  tone?: 'neutral' | 'positive' | 'warning' | 'negative' | 'info'
}

interface BriefField {
  label: string
  value: string | number | boolean | string[]
  semantic?: string
  placement?: 'meta' | 'body' | 'footer'
  emphasis?: 'normal' | 'muted' | 'strong'
  href?: string
}

interface BriefAction {
  label: string
  href?: string
  command?: string
  style?: 'primary' | 'secondary' | 'danger'
}

interface BriefItem {
  title: string
  body?: string
  body_html?: string
}

interface BriefCard {
  type: string
  title: string
  lede?: string
  status?: BriefStatus
  urgency?: BriefStatus
  fields?: BriefField[]
  body?: string
  body_html?: string
  items?: BriefItem[]
  actions?: BriefAction[]
}

interface BriefSection {
  semantic: string
  title: string
  description?: string
  layout?: 'stack' | 'grid'
  cards: BriefCard[]
}

interface OperatorBrief {
  schema_version: 1
  brief_type: string
  title: string
  subtitle?: string
  eyebrow?: string
  generated_at?: string
  source?: string
  sections: BriefSection[]
}

export interface BriefSystemValidationResult {
  status: 'passed' | 'failed'
  errors: string[]
  common_registry_path: string
  project_registry_path: string
  project_css_path: string
}

export interface BriefBuildResult {
  status: 'built' | 'unchanged'
  project_registry_path: string
  project_css_path: string
  created: string[]
}

export interface BriefRenderResult {
  status: 'rendered'
  input_path: string
  output_path: string
  brief_type: string
  sections: number
  cards: number
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function definitionMap(
  value: unknown,
  source: string,
  errors: string[],
): Record<string, BriefDefinition> {
  if (!isRecord(value)) {
    errors.push(`${source} MUST be an object.`)
    return {}
  }

  const result: Record<string, BriefDefinition> = {}

  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) {
      errors.push(`${source}.${key} MUST be an object.`)
      continue
    }

    const label = stringValue(entry.label)
    const description = stringValue(entry.description)

    if (!label || !description) {
      errors.push(
        `${source}.${key} MUST define non-empty label and description.`,
      )
      continue
    }

    result[key] = { label, description }
  }

  return result
}

function sectionSemanticMap(
  value: unknown,
  source: string,
  errors: string[],
): Record<string, SectionSemantic> {
  const definitions = definitionMap(value, source, errors)
  const record = recordValue(value) ?? {}
  const result: Record<string, SectionSemantic> = {}

  for (const [key, definition] of Object.entries(definitions)) {
    const entry = recordValue(record[key])
    const emoji = stringValue(entry?.emoji)

    if (!emoji) {
      errors.push(`${source}.${key}.emoji MUST be non-empty.`)
      continue
    }

    result[key] = { ...definition, emoji }
  }

  return result
}

function cardTypeMap(
  value: unknown,
  source: string,
  errors: string[],
): Record<string, CardType> {
  const definitions = definitionMap(value, source, errors)
  const record = recordValue(value) ?? {}
  const result: Record<string, CardType> = {}

  for (const [key, definition] of Object.entries(definitions)) {
    const entry = recordValue(record[key])
    const layout = entry?.layout
    const requiredFields = Array.isArray(entry?.required_fields)
      ? entry.required_fields.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
      : undefined

    if (layout !== 'standard' && layout !== 'split-header') {
      errors.push(`${source}.${key}.layout MUST be standard or split-header.`)
      continue
    }

    result[key] = {
      ...definition,
      layout,
      ...(requiredFields ? { required_fields: requiredFields } : {}),
    }
  }

  return result
}

function parseRegistry(
  value: unknown,
  source: string,
  project: boolean,
): { registry: BriefRegistry | ProjectBriefRegistry | null; errors: string[] } {
  const errors: string[] = []

  if (!isRecord(value) || value.schema_version !== 1) {
    return {
      registry: null,
      errors: [`${source} MUST be an object with schema_version 1.`],
    }
  }

  const briefTypes = definitionMap(
    value.brief_types,
    `${source}.brief_types`,
    errors,
  )
  const sectionSemantics = sectionSemanticMap(
    value.section_semantics,
    `${source}.section_semantics`,
    errors,
  )
  const cardTypes = cardTypeMap(
    value.card_types,
    `${source}.card_types`,
    errors,
  )
  const fieldSemantics = definitionMap(
    value.field_semantics,
    `${source}.field_semantics`,
    errors,
  )
  const base: BriefRegistry = {
    schema_version: 1,
    brief_types: briefTypes,
    section_semantics: sectionSemantics,
    card_types: cardTypes,
    field_semantics: fieldSemantics,
  }

  if (!project) {
    return { registry: errors.length === 0 ? base : null, errors }
  }

  const projectValue = recordValue(value.project)
  const projectId = stringValue(projectValue?.id)
  const projectTitle = stringValue(projectValue?.title)

  if (
    value.status !== 'ready' ||
    value.extends !== 'pancreator' ||
    !projectId ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(projectId) ||
    !projectTitle
  ) {
    errors.push(
      `${source} MUST declare status ready, extend pancreator, and define a kebab-case project id plus title.`,
    )
  }

  return {
    registry:
      errors.length === 0 && projectId && projectTitle
        ? {
            ...base,
            status: 'ready',
            extends: 'pancreator',
            project: { id: projectId, title: projectTitle },
          }
        : null,
    errors,
  }
}

function collisionErrors(
  common: BriefRegistry,
  project: ProjectBriefRegistry,
): string[] {
  const errors: string[] = []
  const groups: Array<
    [string, Record<string, unknown>, Record<string, unknown>]
  > = [
    ['brief_types', common.brief_types, project.brief_types],
    ['section_semantics', common.section_semantics, project.section_semantics],
    ['card_types', common.card_types, project.card_types],
    ['field_semantics', common.field_semantics, project.field_semantics],
  ]

  for (const [group, commonValues, projectValues] of groups) {
    for (const key of Object.keys(projectValues)) {
      if (key in commonValues) {
        errors.push(
          `docs/operator-briefs/project.json ${group}.${key} collides with the Pancreator-owned definition. Use a project-specific semantic key instead of overriding shared meaning.`,
        )
      }
    }
  }

  const emojiOwners = new Map<string, string>()

  for (const [key, semantic] of Object.entries({
    ...common.section_semantics,
    ...project.section_semantics,
  })) {
    const owner = emojiOwners.get(semantic.emoji)

    if (owner && owner !== key) {
      errors.push(
        `Section emoji ${semantic.emoji} is assigned to both '${owner}' and '${key}'. One emoji MUST retain one section meaning within the repository.`,
      )
    } else {
      emojiOwners.set(semantic.emoji, key)
    }
  }

  const fieldSemantics = {
    ...common.field_semantics,
    ...project.field_semantics,
  }

  for (const [key, cardType] of Object.entries({
    ...common.card_types,
    ...project.card_types,
  })) {
    for (const required of cardType.required_fields ?? []) {
      if (!(required in fieldSemantics)) {
        errors.push(
          `Card type '${key}' requires unknown field semantic '${required}'.`,
        )
      }
    }
  }

  return errors
}

function readRegistries(root: string): {
  common: BriefRegistry
  project: ProjectBriefRegistry
} {
  const validation = validateBriefSystem(root)

  invariant(validation.status === 'passed', validation.errors.join('\n'), {
    code: 'INVALID_BRIEF_SYSTEM',
    details: validation,
  })

  const common = parseRegistry(
    readJson(resolveInside(root, COMMON_REGISTRY_PATH)),
    COMMON_REGISTRY_PATH,
    false,
  ).registry
  const project = parseRegistry(
    readJson(resolveInside(root, PROJECT_REGISTRY_PATH)),
    PROJECT_REGISTRY_PATH,
    true,
  ).registry

  invariant(common && project, 'Brief registries failed after validation.', {
    code: 'INVALID_BRIEF_SYSTEM',
  })

  return {
    common: common as BriefRegistry,
    project: project as ProjectBriefRegistry,
  }
}

function slugifyProjectId(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')

  return normalized || 'target-repository'
}

function projectIdentity(root: string): { id: string; title: string } {
  const workspace = path.resolve(root, configuredWorkspaceRoot(root))
  const title = path.basename(workspace) || 'Target repository'

  return { id: slugifyProjectId(title), title }
}

export function buildBriefSystem(
  root: string,
  options: { force?: boolean } = {},
): BriefBuildResult {
  const registryPath = resolveInside(root, PROJECT_REGISTRY_PATH)
  const cssPath = resolveInside(root, PROJECT_CSS_PATH)
  const created: string[] = []
  const identity = projectIdentity(root)

  if (options.force || !fileExists(registryPath)) {
    const template = readText(resolveInside(root, PROJECT_REGISTRY_TEMPLATE))
      .replaceAll('__PROJECT_ID__', identity.id)
      .replaceAll('__PROJECT_TITLE__', identity.title)

    writeTextAtomic(registryPath, template)
    created.push(PROJECT_REGISTRY_PATH)
  }

  if (options.force || !fileExists(cssPath)) {
    writeTextAtomic(
      cssPath,
      readText(resolveInside(root, PROJECT_CSS_TEMPLATE)),
    )
    created.push(PROJECT_CSS_PATH)
  }

  return {
    status: created.length > 0 ? 'built' : 'unchanged',
    project_registry_path: PROJECT_REGISTRY_PATH,
    project_css_path: PROJECT_CSS_PATH,
    created,
  }
}

export function validateBriefSystem(root: string): BriefSystemValidationResult {
  const errors: string[] = []
  const commonPath = path.join(root, COMMON_REGISTRY_PATH)
  const projectPath = path.join(root, PROJECT_REGISTRY_PATH)
  const cssPath = path.join(root, PROJECT_CSS_PATH)

  if (!fileExists(commonPath)) {
    errors.push(`Missing common brief registry: ${COMMON_REGISTRY_PATH}`)
  }

  if (!fileExists(projectPath)) {
    errors.push(
      `Missing project brief registry: ${PROJECT_REGISTRY_PATH}. Run pan briefs build.`,
    )
  }

  if (!fileExists(cssPath)) {
    errors.push(
      `Missing project brief design system: ${PROJECT_CSS_PATH}. Run pan briefs build.`,
    )
  }

  if (!fileExists(path.join(root, BASE_CSS_PATH))) {
    errors.push(`Missing Pancreator brief CSS: ${BASE_CSS_PATH}`)
  }

  let common: BriefRegistry | null = null
  let project: ProjectBriefRegistry | null = null

  if (fileExists(commonPath)) {
    const parsed = parseRegistry(
      readJson(commonPath),
      COMMON_REGISTRY_PATH,
      false,
    )

    errors.push(...parsed.errors)
    common = parsed.registry as BriefRegistry | null
  }

  if (fileExists(projectPath)) {
    const parsed = parseRegistry(
      readJson(projectPath),
      PROJECT_REGISTRY_PATH,
      true,
    )

    errors.push(...parsed.errors)
    project = parsed.registry as ProjectBriefRegistry | null
  }

  if (common && project) {
    errors.push(...collisionErrors(common, project))
  }

  if (fileExists(cssPath)) {
    const css = readText(cssPath)

    if (!/:root\s*\{/u.test(css)) {
      errors.push(
        `${PROJECT_CSS_PATH} MUST define project design tokens in a :root block.`,
      )
    }

    if (/<\/?(?:script|style)[^>]*>/iu.test(css)) {
      errors.push(`${PROJECT_CSS_PATH} MUST contain CSS only.`)
    }
  }

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    errors,
    common_registry_path: COMMON_REGISTRY_PATH,
    project_registry_path: PROJECT_REGISTRY_PATH,
    project_css_path: PROJECT_CSS_PATH,
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPlainText(value: string): string {
  return value
    .split(/\n{2,}/u)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replaceAll('\n', '<br>')}</p>`,
    )
    .join('\n')
}

function unsafeHtml(value: string): boolean {
  return (
    /<(?:script|style|link|iframe|object|embed|form|base|meta)\b/iu.test(
      value,
    ) ||
    /\s(?:on[a-z]+|style)\s*=/iu.test(value) ||
    /javascript\s*:/iu.test(value)
  )
}

function safeHref(value: string): boolean {
  return !/^\s*(?:javascript|data):/iu.test(value)
}

function parseStatus(
  value: unknown,
  source: string,
  errors: string[],
): BriefStatus | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    errors.push(`${source} MUST be an object.`)
    return undefined
  }

  const label = stringValue(value.label)
  const tone = value.tone

  if (!label) {
    errors.push(`${source}.label MUST be non-empty.`)
    return undefined
  }

  if (
    tone !== undefined &&
    !['neutral', 'positive', 'warning', 'negative', 'info'].includes(
      String(tone),
    )
  ) {
    errors.push(`${source}.tone is invalid.`)
    return undefined
  }

  return {
    label,
    ...(typeof tone === 'string' ? { tone: tone as BriefStatus['tone'] } : {}),
  }
}

function parseField(
  value: unknown,
  source: string,
  fieldSemantics: Record<string, BriefDefinition>,
  errors: string[],
): BriefField | null {
  if (!isRecord(value)) {
    errors.push(`${source} MUST be an object.`)
    return null
  }

  const label = stringValue(value.label)
  const raw = value.value
  const validValue =
    typeof raw === 'string' ||
    typeof raw === 'number' ||
    typeof raw === 'boolean' ||
    (Array.isArray(raw) && raw.every((item) => typeof item === 'string'))

  if (!label || !validValue) {
    errors.push(
      `${source} MUST define label and a scalar or string-array value.`,
    )
    return null
  }

  const semantic = stringValue(value.semantic) ?? undefined

  if (semantic && !(semantic in fieldSemantics)) {
    errors.push(
      `${source}.semantic references unknown field semantic '${semantic}'.`,
    )
  }

  const placement = value.placement
  const emphasis = value.emphasis
  const href = stringValue(value.href) ?? undefined

  if (
    placement !== undefined &&
    !['meta', 'body', 'footer'].includes(String(placement))
  ) {
    errors.push(`${source}.placement is invalid.`)
  }

  if (
    emphasis !== undefined &&
    !['normal', 'muted', 'strong'].includes(String(emphasis))
  ) {
    errors.push(`${source}.emphasis is invalid.`)
  }

  if (href && !safeHref(href)) {
    errors.push(`${source}.href uses a disallowed URL scheme.`)
  }

  return {
    label,
    value: raw as BriefField['value'],
    ...(semantic ? { semantic } : {}),
    ...(typeof placement === 'string'
      ? { placement: placement as BriefField['placement'] }
      : {}),
    ...(typeof emphasis === 'string'
      ? { emphasis: emphasis as BriefField['emphasis'] }
      : {}),
    ...(href ? { href } : {}),
  }
}

function parseBrief(
  value: unknown,
  registries: { common: BriefRegistry; project: ProjectBriefRegistry },
  source: string,
): { brief: OperatorBrief | null; errors: string[] } {
  const errors: string[] = []

  if (!isRecord(value) || value.schema_version !== 1) {
    return {
      brief: null,
      errors: [`${source} MUST be an object with schema_version 1.`],
    }
  }

  const briefTypes = {
    ...registries.common.brief_types,
    ...registries.project.brief_types,
  }
  const sectionSemantics = {
    ...registries.common.section_semantics,
    ...registries.project.section_semantics,
  }
  const cardTypes = {
    ...registries.common.card_types,
    ...registries.project.card_types,
  }
  const fieldSemantics = {
    ...registries.common.field_semantics,
    ...registries.project.field_semantics,
  }
  const briefType = stringValue(value.brief_type)
  const title = stringValue(value.title)

  if (!briefType || !(briefType in briefTypes)) {
    errors.push(`${source}.brief_type references an unknown brief type.`)
  }

  if (!title) {
    errors.push(`${source}.title MUST be non-empty.`)
  }

  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    errors.push(`${source}.sections MUST be a non-empty array.`)
    return { brief: null, errors }
  }

  const sections: BriefSection[] = []

  for (const [sectionIndex, sectionValue] of value.sections.entries()) {
    const sectionSource = `${source}.sections[${sectionIndex}]`

    if (!isRecord(sectionValue)) {
      errors.push(`${sectionSource} MUST be an object.`)
      continue
    }

    const semantic = stringValue(sectionValue.semantic)
    const sectionTitle = stringValue(sectionValue.title)
    const layout = sectionValue.layout

    if (!semantic || !(semantic in sectionSemantics)) {
      errors.push(`${sectionSource}.semantic references an unknown semantic.`)
    }

    if (!sectionTitle || sectionTitle.length > 70) {
      errors.push(
        `${sectionSource}.title MUST be non-empty and at most 70 characters.`,
      )
    }

    if (layout !== undefined && layout !== 'stack' && layout !== 'grid') {
      errors.push(`${sectionSource}.layout MUST be stack or grid.`)
    }

    if (!Array.isArray(sectionValue.cards) || sectionValue.cards.length === 0) {
      errors.push(`${sectionSource}.cards MUST be a non-empty array.`)
      continue
    }

    const cards: BriefCard[] = []

    for (const [cardIndex, cardValue] of sectionValue.cards.entries()) {
      const cardSource = `${sectionSource}.cards[${cardIndex}]`

      if (!isRecord(cardValue)) {
        errors.push(`${cardSource} MUST be an object.`)
        continue
      }

      const cardType = stringValue(cardValue.type)
      const cardTitle = stringValue(cardValue.title)

      if (!cardType || !(cardType in cardTypes)) {
        errors.push(`${cardSource}.type references an unknown card type.`)
      }

      if (!cardTitle) {
        errors.push(`${cardSource}.title MUST be non-empty.`)
      }

      const body = stringValue(cardValue.body) ?? undefined
      const bodyHtml = stringValue(cardValue.body_html) ?? undefined

      if (body && bodyHtml) {
        errors.push(`${cardSource} MUST NOT define both body and body_html.`)
      }

      if (bodyHtml && unsafeHtml(bodyHtml)) {
        errors.push(`${cardSource}.body_html contains active or unsafe HTML.`)
      }

      const fields = Array.isArray(cardValue.fields)
        ? cardValue.fields.flatMap((field, fieldIndex) => {
            const parsed = parseField(
              field,
              `${cardSource}.fields[${fieldIndex}]`,
              fieldSemantics,
              errors,
            )

            return parsed ? [parsed] : []
          })
        : []
      const requiredFields = cardType
        ? (cardTypes[cardType]?.required_fields ?? [])
        : []
      const fieldKeys = new Set(
        fields.map((field) => field.semantic).filter(Boolean),
      )

      for (const required of requiredFields) {
        if (!fieldKeys.has(required)) {
          errors.push(
            `${cardSource} card type '${cardType}' requires field semantic '${required}'.`,
          )
        }
      }

      const items: BriefItem[] = []

      if (Array.isArray(cardValue.items)) {
        for (const [itemIndex, itemValue] of cardValue.items.entries()) {
          const itemSource = `${cardSource}.items[${itemIndex}]`

          if (!isRecord(itemValue)) {
            errors.push(`${itemSource} MUST be an object.`)
            continue
          }

          const itemTitle = stringValue(itemValue.title)
          const itemBody = stringValue(itemValue.body) ?? undefined
          const itemBodyHtml = stringValue(itemValue.body_html) ?? undefined

          if (!itemTitle) {
            errors.push(`${itemSource}.title MUST be non-empty.`)
            continue
          }

          if (itemBody && itemBodyHtml) {
            errors.push(
              `${itemSource} MUST NOT define both body and body_html.`,
            )
          }

          if (itemBodyHtml && unsafeHtml(itemBodyHtml)) {
            errors.push(
              `${itemSource}.body_html contains active or unsafe HTML.`,
            )
          }

          items.push({
            title: itemTitle,
            ...(itemBody ? { body: itemBody } : {}),
            ...(itemBodyHtml ? { body_html: itemBodyHtml } : {}),
          })
        }
      }

      const actions: BriefAction[] = []

      if (Array.isArray(cardValue.actions)) {
        for (const [actionIndex, actionValue] of cardValue.actions.entries()) {
          const actionSource = `${cardSource}.actions[${actionIndex}]`

          if (!isRecord(actionValue)) {
            errors.push(`${actionSource} MUST be an object.`)
            continue
          }

          const label = stringValue(actionValue.label)
          const href = stringValue(actionValue.href) ?? undefined
          const command = stringValue(actionValue.command) ?? undefined
          const style = actionValue.style

          if (!label || (!href && !command) || (href && command)) {
            errors.push(
              `${actionSource} MUST define a label and exactly one of href or command.`,
            )
            continue
          }

          if (href && !safeHref(href)) {
            errors.push(`${actionSource}.href uses a disallowed URL scheme.`)
          }

          if (
            style !== undefined &&
            !['primary', 'secondary', 'danger'].includes(String(style))
          ) {
            errors.push(`${actionSource}.style is invalid.`)
          }

          actions.push({
            label,
            ...(href ? { href } : {}),
            ...(command ? { command } : {}),
            ...(typeof style === 'string'
              ? { style: style as BriefAction['style'] }
              : {}),
          })
        }
      }

      const status = parseStatus(
        cardValue.status,
        `${cardSource}.status`,
        errors,
      )
      const urgency = parseStatus(
        cardValue.urgency,
        `${cardSource}.urgency`,
        errors,
      )
      const lede = stringValue(cardValue.lede)

      if (cardType && cardTitle) {
        cards.push({
          type: cardType,
          title: cardTitle,
          ...(lede ? { lede } : {}),
          ...(status ? { status } : {}),
          ...(urgency ? { urgency } : {}),
          ...(fields.length > 0 ? { fields } : {}),
          ...(body ? { body } : {}),
          ...(bodyHtml ? { body_html: bodyHtml } : {}),
          ...(items.length > 0 ? { items } : {}),
          ...(actions.length > 0 ? { actions } : {}),
        })
      }
    }

    if (semantic && sectionTitle && cards.length > 0) {
      sections.push({
        semantic,
        title: sectionTitle,
        ...(stringValue(sectionValue.description)
          ? { description: stringValue(sectionValue.description) ?? undefined }
          : {}),
        ...(typeof layout === 'string'
          ? { layout: layout as BriefSection['layout'] }
          : {}),
        cards,
      })
    }
  }

  if (sections[0]?.semantic !== 'executive-summary') {
    errors.push(
      `${source}.sections[0] MUST use the 'executive-summary' semantic.`,
    )
  }

  const generatedAt = stringValue(value.generated_at) ?? undefined

  if (generatedAt && Number.isNaN(Date.parse(generatedAt))) {
    errors.push(`${source}.generated_at MUST be an ISO-8601 timestamp.`)
  }

  return {
    brief:
      errors.length === 0 && briefType && title
        ? {
            schema_version: 1,
            brief_type: briefType,
            title,
            ...(stringValue(value.subtitle)
              ? { subtitle: stringValue(value.subtitle) ?? undefined }
              : {}),
            ...(stringValue(value.eyebrow)
              ? { eyebrow: stringValue(value.eyebrow) ?? undefined }
              : {}),
            ...(generatedAt ? { generated_at: generatedAt } : {}),
            ...(stringValue(value.source)
              ? { source: stringValue(value.source) ?? undefined }
              : {}),
            sections,
          }
        : null,
    errors,
  }
}

function renderFieldValue(field: BriefField): string {
  const value = Array.isArray(field.value)
    ? `<span>${field.value.map((item) => escapeHtml(item)).join('<br>')}</span>`
    : escapeHtml(String(field.value))
  const rendered = field.href
    ? `<a href="${escapeHtml(field.href)}">${value}</a>`
    : value

  return rendered
}

function renderFields(
  fields: BriefField[],
  placement: BriefField['placement'],
): string {
  const matching = fields.filter(
    (field) => (field.placement ?? 'body') === placement,
  )

  if (matching.length === 0) {
    return ''
  }

  const modifier = placement === 'meta' ? ' pc-fields--meta' : ''

  return `<dl class="pc-fields${modifier}">
${matching
  .map(
    (
      field,
    ) => `  <div class="pc-field"${field.semantic ? ` data-field-semantic="${escapeHtml(field.semantic)}"` : ''} data-emphasis="${field.emphasis ?? 'normal'}">
    <dt class="pc-field__label">${escapeHtml(field.label)}</dt>
    <dd class="pc-field__value">${renderFieldValue(field)}</dd>
  </div>`,
  )
  .join('\n')}
</dl>`
}

function renderStatusBadge(
  kind: string,
  status: BriefStatus | undefined,
): string {
  if (!status) {
    return ''
  }

  return `<span class="pc-badge" data-kind="${kind}" data-tone="${status.tone ?? 'neutral'}">${escapeHtml(status.label)}</span>`
}

function renderCard(
  card: BriefCard,
  cardTypes: Record<string, CardType>,
): string {
  const fields = card.fields ?? []
  const badges = [
    renderStatusBadge('status', card.status),
    renderStatusBadge('urgency', card.urgency),
  ].filter(Boolean)
  const body = card.body ? renderPlainText(card.body) : (card.body_html ?? '')
  const items = (card.items ?? [])
    .map(
      (item) => `<div class="pc-item">
  <h4 class="pc-item__title">${escapeHtml(item.title)}</h4>
  ${item.body ? `<div class="pc-item__body">${renderPlainText(item.body)}</div>` : item.body_html ? `<div class="pc-item__body">${item.body_html}</div>` : ''}
</div>`,
    )
    .join('\n')
  const actions = (card.actions ?? [])
    .map((action) => {
      const style = action.style ?? 'secondary'

      return action.href
        ? `<a class="pc-action" data-style="${style}" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
        : `<span class="pc-action" data-style="${style}" title="${escapeHtml(action.label)}"><code>${escapeHtml(action.command ?? '')}</code></span>`
    })
    .join('\n')

  const layout = cardTypes[card.type]?.layout ?? 'standard'

  return `<article class="pc-card" data-card-type="${escapeHtml(card.type)}" data-layout="${layout}">
  <header class="pc-card__header">
    <div>
      <h3 class="pc-card__title">${escapeHtml(card.title)}</h3>
      ${card.lede ? `<p class="pc-card__lede">${escapeHtml(card.lede)}</p>` : ''}
      ${badges.length > 0 ? `<div class="pc-card__badges">${badges.join('')}</div>` : ''}
    </div>
    ${renderFields(fields, 'meta')}
  </header>
  ${renderFields(fields, 'body')}
  ${body ? `<div class="pc-card__body">${body}</div>` : ''}
  ${renderFields(fields, 'footer')}
  ${actions ? `<div class="pc-card__actions">${actions}</div>` : ''}
  ${items ? `<div class="pc-card__items">${items}</div>` : ''}
</article>`
}

function renderHtml(
  brief: OperatorBrief,
  registries: { common: BriefRegistry; project: ProjectBriefRegistry },
  css: string,
): string {
  const sectionSemantics = {
    ...registries.common.section_semantics,
    ...registries.project.section_semantics,
  }
  const briefTypes = {
    ...registries.common.brief_types,
    ...registries.project.brief_types,
  }
  const cardTypes = {
    ...registries.common.card_types,
    ...registries.project.card_types,
  }
  const sections = brief.sections
    .map((section) => {
      const semantic = sectionSemantics[section.semantic]

      return `<section class="pc-section" data-section-semantic="${escapeHtml(section.semantic)}" data-layout="${section.layout ?? 'stack'}">
  <header class="pc-section__header">
    <span class="pc-section__emoji" aria-hidden="true">${semantic.emoji}</span>
    <h2 class="pc-section__title">${escapeHtml(section.title)}</h2>
  </header>
  ${section.description ? `<p class="pc-section__description">${escapeHtml(section.description)}</p>` : ''}
  <div class="pc-section__cards">
${section.cards.map((card) => renderCard(card, cardTypes)).join('\n')}
  </div>
</section>`
    })
    .join('\n')
  const generatedAt = brief.generated_at ?? new Date().toISOString()
  const metadata = [
    `<span>Type: ${escapeHtml(briefTypes[brief.brief_type].label)}</span>`,
    `<time datetime="${escapeHtml(generatedAt)}">Generated ${escapeHtml(generatedAt)}</time>`,
    ...(brief.source
      ? [`<span>Source: ${escapeHtml(brief.source)}</span>`]
      : []),
  ]

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(brief.title)}</title>
  <style>
${css}
  </style>
</head>
<body>
<main class="pc-brief" data-brief-type="${escapeHtml(brief.brief_type)}" data-brief-schema-version="1">
  <header class="pc-brief__header">
    <p class="pc-brief__eyebrow">${escapeHtml(brief.eyebrow ?? registries.project.project.title)}</p>
    <h1 class="pc-brief__title">${escapeHtml(brief.title)}</h1>
    ${brief.subtitle ? `<p class="pc-brief__subtitle">${escapeHtml(brief.subtitle)}</p>` : ''}
    <div class="pc-brief__meta">${metadata.join('')}</div>
  </header>
${sections}
  <footer class="pc-brief__footer">Rendered with the Pancreator operator brief system.</footer>
</main>
</body>
</html>
`
}

export interface BriefScaffoldOptions {
  source_path: string
  profile: string
  title: string
  source: string
}

const PROFILE_SECTION_SEMANTICS: Record<string, string[]> = {
  intake: ['context', 'actions', 'risks'],
  plan: ['workflow', 'changes', 'validation'],
  implementation: ['changes', 'validation', 'actions'],
  review: ['evidence', 'validation'],
  qa: ['validation', 'risks', 'actions'],
  release: ['release', 'validation'],
  inspection: ['evidence', 'validation'],
}

/**
 * Create the operator-brief source at the exact indexed path before delegation.
 * Workers edit this file in place; they never need to discover a brief location
 * or invoke the renderer themselves.
 */
export function scaffoldOperatorBrief(
  root: string,
  options: BriefScaffoldOptions,
): void {
  const absolute = resolveInside(root, options.source_path)

  if (fileExists(absolute)) {
    return
  }

  const requiredHeadings = OPERATOR_ARTIFACT_PROFILE_HEADINGS[
    options.profile as keyof typeof OPERATOR_ARTIFACT_PROFILE_HEADINGS
  ] ?? ['details']
  const semantics = PROFILE_SECTION_SEMANTICS[options.profile] ?? [
    'context',
    'actions',
  ]
  const sections: BriefSection[] = [
    {
      semantic: 'executive-summary',
      title: 'Executive summary',
      cards: [
        {
          type: 'summary',
          title: 'Bottom line',
          body: 'Replace this scaffold with the concise operator-facing outcome, why it matters, and immediate next action.',
        },
      ],
    },
    ...requiredHeadings.map((heading, index) => {
      const semantic = semantics[index % semantics.length] ?? 'context'

      return {
        semantic,
        title: heading
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
        cards: [
          {
            type:
              semantic === 'validation'
                ? 'validation'
                : semantic === 'risks'
                  ? 'risk'
                  : semantic === 'release'
                    ? 'release'
                    : semantic === 'actions'
                      ? 'action'
                      : 'summary',
            title: 'Complete this section',
            body: 'Replace this placeholder with stage-specific operator-facing content.',
          },
        ],
      }
    }),
  ]

  writeJsonAtomic(absolute, {
    schema_version: 1,
    brief_type: options.profile === 'release' ? 'release' : 'workflow-run',
    title: options.title,
    source: options.source,
    sections,
  })
}

export function renderBrief(
  root: string,
  inputPath: string,
  outputPath: string,
): BriefRenderResult {
  const registries = readRegistries(root)
  const inputRelative = inputPath
  const outputRelative = outputPath
  const parsed = parseBrief(
    readJson(resolveInside(root, inputRelative)),
    registries,
    inputRelative,
  )

  invariant(parsed.brief, parsed.errors.join('\n'), {
    code: 'INVALID_OPERATOR_BRIEF',
    details: { errors: parsed.errors },
  })
  invariant(outputRelative.endsWith('.html'), 'Brief output MUST use .html.', {
    code: 'INVALID_ARGUMENT',
  })

  const css = `${readText(resolveInside(root, BASE_CSS_PATH))}\n${readText(
    resolveInside(root, PROJECT_CSS_PATH),
  )}`
  const html = renderHtml(parsed.brief, registries, css)

  writeTextAtomic(resolveInside(root, outputRelative), html)

  return {
    status: 'rendered',
    input_path: inputRelative,
    output_path: outputRelative,
    brief_type: parsed.brief.brief_type,
    sections: parsed.brief.sections.length,
    cards: parsed.brief.sections.reduce(
      (total, section) => total + section.cards.length,
      0,
    ),
  }
}
