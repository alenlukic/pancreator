/**
 * Operator brief HTML rendering: turns a parsed brief into one self-contained
 * HTML page styled by the Pancreator base CSS and the project design tokens.
 */

import { invariant } from '../errors.js'
import { readJson, readText, resolveInside, writeTextAtomic } from '../io.js'
import { parseBrief } from './parse.js'
import { BASE_CSS_PATH, PROJECT_CSS_PATH, readRegistries } from './registry.js'
import type {
  BriefCard,
  BriefField,
  BriefRegistry,
  BriefRenderResult,
  BriefStatus,
  CardType,
  OperatorBrief,
  ProjectBriefRegistry,
} from './types.js'

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

/**
 * Parse a brief JSON source and atomically write it as a self-contained HTML
 * page with the base and project CSS inlined, returning section and card
 * counts. Throws `PanError` `INVALID_OPERATOR_BRIEF` for an invalid brief,
 * `INVALID_ARGUMENT` when the output path does not end in `.html`, and
 * `INVALID_BRIEF_SYSTEM` when the registries fail validation.
 */
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
