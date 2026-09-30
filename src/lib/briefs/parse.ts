/**
 * Operator brief source parsing: checks a brief against the merged registry
 * vocabulary and the safe-HTML rules, and writes a validated source.
 */

import { invariant } from '../errors.js'
import { isRecord, resolveInside, writeJsonAtomic } from '../io.js'
import { readRegistries, stringValue } from './registry.js'
import type {
  BriefAction,
  BriefCard,
  BriefDefinition,
  BriefField,
  BriefItem,
  BriefRegistry,
  BriefSection,
  BriefStatus,
  OperatorBrief,
  ProjectBriefRegistry,
} from './types.js'

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

/**
 * Name the rejected value and the closed vocabulary in one message. The brief
 * schema types these fields as open strings and workers are barred from running
 * the renderer, so this message is the only place a worker or operator learns
 * which value failed and what would have been accepted.
 */
function unknownVocabularyMessage(
  source: string,
  label: string,
  value: string | null,
  allowed: Record<string, unknown>,
): string {
  const got = value === null ? 'missing' : `'${value}'`
  const vocabulary = Object.keys(allowed).sort().join(', ')

  return `${source} references an unknown ${label} (got ${got}; allowed: ${vocabulary}).`
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
      unknownVocabularyMessage(
        `${source}.semantic`,
        'field semantic',
        semantic,
        fieldSemantics,
      ),
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

/**
 * Validate a raw operator brief source against the merged primitive and
 * project vocabularies and return the normalized brief with every error
 * found. The brief is null when any error exists; checks include unsafe HTML,
 * disallowed link schemes, required card fields, and an `executive-summary`
 * first section. Errors name paths under `source`.
 */
export function parseBrief(
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
    errors.push(
      unknownVocabularyMessage(
        `${source}.brief_type`,
        'brief type',
        briefType,
        briefTypes,
      ),
    )
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
      errors.push(
        unknownVocabularyMessage(
          `${sectionSource}.semantic`,
          'section semantic',
          semantic,
          sectionSemantics,
        ),
      )
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
        errors.push(
          unknownVocabularyMessage(
            `${cardSource}.type`,
            'card type',
            cardType,
            cardTypes,
          ),
        )
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

/** Validate and write a complete operator brief source atomically. */
export function writeOperatorBriefSource(
  root: string,
  sourcePath: string,
  brief: OperatorBrief,
): void {
  const parsed = parseBrief(brief, readRegistries(root), sourcePath)

  invariant(parsed.brief, parsed.errors.join('\n'), {
    code: 'INVALID_OPERATOR_BRIEF',
    details: { errors: parsed.errors },
  })
  writeJsonAtomic(resolveInside(root, sourcePath), parsed.brief)
}
