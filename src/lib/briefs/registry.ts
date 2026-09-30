/**
 * Operator brief registries: the Pancreator-owned primitives and the
 * target-owned project layer. Builds the project layer from templates,
 * validates both layers and their collisions, and loads them for parsing and
 * rendering.
 */

import path from 'node:path'

import { invariant } from '../errors.js'
import {
  fileExists,
  isRecord,
  readJson,
  readText,
  resolveInside,
  writeTextAtomic,
} from '../io.js'
import { configuredWorkspaceRoot } from '../project-config.js'
import type {
  BriefBuildResult,
  BriefDefinition,
  BriefRegistry,
  BriefSystemValidationResult,
  CardType,
  ProjectBriefRegistry,
  SectionSemantic,
} from './types.js'

const COMMON_REGISTRY_PATH = 'library/operator-briefs/primitives.json'
export const BASE_CSS_PATH = 'library/operator-briefs/base.css'
const PROJECT_REGISTRY_PATH = 'docs/operator-briefs/project.json'
export const PROJECT_CSS_PATH = 'docs/operator-briefs/project.css'
const PROJECT_REGISTRY_TEMPLATE =
  'library/templates/operator-briefs/project.json'
const PROJECT_CSS_TEMPLATE = 'library/templates/operator-briefs/project.css'

export function stringValue(value: unknown): string | null {
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

export function readRegistries(root: string): {
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
