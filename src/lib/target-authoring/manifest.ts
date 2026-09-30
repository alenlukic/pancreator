/**
 * Target extension shapes, their paths inside a target, and the strict parsers
 * of an authoring draft and a published extension manifest.
 */

import path from 'node:path'

import type { CursorInstallationMode } from '../cursor-content.js'
import { invariant } from '../errors.js'
import { isRecord, fileExists, readJson } from '../io.js'
import {
  loadProjectConfig,
  configuredWorkspaceRoot,
} from '../project-config.js'
import { isPancreatorOwnedCursorBasename } from '../projection.js'

export type TargetExtensionKind = 'command' | 'skill' | 'persona'

export interface TargetExtensionManifest {
  schema_version: 1
  extension_id: string
  kind: TargetExtensionKind
  title: string
  summary: string
  policy_persona: string
  policies: string[]
  context: {
    persona: string
    workflow: 'standalone'
    stage: string
  }
  content_path: string
  content_sha256: string
  model?: string
  agent_path?: string
  agent_sha256?: string
  projection_path?: string
  projection_sha256?: string
}

export interface TargetAuthoringDraft {
  schema_version: 1
  extension_id: string
  kind: TargetExtensionKind
  title: string
  summary: string
  content: string
  policy_persona: string
  policies: string[]
  model?: string
  expected_manifest_sha256?: string
}

export interface TargetAuthoringApplyResult {
  status: 'applied' | 'unchanged'
  extension_id: string
  manifest_path: string
  content_path: string
  lookup_path: string
  projection_path: string | null
  manifest_sha256: string
  policies: string[]
}

export interface TargetAuthoringValidationResult {
  ok: boolean
  errors: string[]
  extensions: string[]
}

const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const POLICY_ID_PATTERN = /^[A-Z][A-Z0-9-]*-\d{3}$/u
const POLICY_FILE_PATTERN = /governance\/policies\/[A-Z]+-\d{3}\.json/u
export const EXCLUDE_BEGIN = '# >>> pancreator target extensions >>>'
export const EXCLUDE_END = '# <<< pancreator target extensions <<<'

export function installationMode(root: string): CursorInstallationMode {
  const mode = loadProjectConfig(root).installation_mode

  invariant(
    mode === 'embedded' || mode === 'detached',
    'Target authoring is available only in embedded or detached installations.',
    { code: 'TARGET_AUTHORING_UNAVAILABLE' },
  )

  return mode
}

export function targetRoot(root: string, workspace?: string): string {
  return path.resolve(root, workspace ?? configuredWorkspaceRoot(root))
}

export function extensionDirectory(root: string, extensionId: string): string {
  return path.join(root, 'target-extensions', extensionId)
}

export function manifestRelativePath(extensionId: string): string {
  return `target-extensions/${extensionId}/manifest.json`
}

export function contentFilename(kind: TargetExtensionKind): string {
  return `${kind}.md`
}

export function projectionRelativePath(
  kind: TargetExtensionKind,
  extensionId: string,
): string | null {
  if (kind === 'command') {
    return `.cursor/commands/${extensionId}.md`
  }

  if (kind === 'persona') {
    return `.cursor/agents/${extensionId}.md`
  }

  return null
}

export function agentRelativePath(
  kind: TargetExtensionKind,
  extensionId: string,
): string | null {
  return kind === 'persona' ? `target-extensions/${extensionId}/agent.md` : null
}

function assertString(value: unknown, source: string): asserts value is string {
  invariant(
    typeof value === 'string' && value.trim().length > 0,
    `${source} MUST be a non-empty string.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
}

/** Every key `library/schemas/target-authoring.schema.json` declares. */
const DRAFT_KEYS = new Set([
  'schema_version',
  'extension_id',
  'kind',
  'title',
  'summary',
  'content',
  'policy_persona',
  'policies',
  'model',
  'expected_manifest_sha256',
])

export function parseDraft(
  value: unknown,
  source: string,
): TargetAuthoringDraft {
  invariant(
    isRecord(value) && value.schema_version === 1,
    `${source} MUST contain schema_version 1.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  assertString(value.extension_id, `${source}.extension_id`)
  invariant(
    EXTENSION_ID_PATTERN.test(value.extension_id),
    `${source}.extension_id MUST use lowercase hyphenated words.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  invariant(
    !isPancreatorOwnedCursorBasename(`${value.extension_id}.md`),
    `${source}.extension_id uses a Pancreator-reserved Cursor basename.`,
    { code: 'RESERVED_TARGET_EXTENSION' },
  )
  invariant(
    value.kind === 'command' ||
      value.kind === 'skill' ||
      value.kind === 'persona',
    `${source}.kind MUST be command, skill, or persona.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  assertString(value.title, `${source}.title`)
  assertString(value.summary, `${source}.summary`)
  assertString(value.content, `${source}.content`)
  assertString(value.policy_persona, `${source}.policy_persona`)
  invariant(
    EXTENSION_ID_PATTERN.test(value.policy_persona),
    `${source}.policy_persona MUST use lowercase hyphenated words.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  invariant(
    Array.isArray(value.policies) &&
      value.policies.every(
        (item) => typeof item === 'string' && POLICY_ID_PATTERN.test(item),
      ),
    `${source}.policies MUST contain policy identifiers.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  invariant(
    new Set(value.policies).size === value.policies.length,
    `${source}.policies MUST NOT contain duplicates.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )
  invariant(
    value.expected_manifest_sha256 === undefined ||
      (typeof value.expected_manifest_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.expected_manifest_sha256)),
    `${source}.expected_manifest_sha256 MUST be a SHA-256 digest when present.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )

  if (value.kind === 'persona') {
    assertString(value.model, `${source}.model`)
  } else {
    invariant(
      value.model === undefined,
      `${source}.model applies to persona drafts only.`,
      { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
    )
  }

  // The schema sets `additionalProperties: false`, and the parser accepted
  // anything. A misspelled key then reached the extension as silence rather
  // than as the rejection the author's schema promised.
  const unknownKeys = Object.keys(value)
    .filter((key) => !DRAFT_KEYS.has(key))
    .sort()

  invariant(
    unknownKeys.length === 0,
    `${source} contains unknown key(s): ${unknownKeys.join(', ')}.`,
    { code: 'INVALID_TARGET_AUTHORING_DRAFT' },
  )

  validateMarkdown(value.kind, value.extension_id, value.content)

  return value as unknown as TargetAuthoringDraft
}

function validateMarkdown(
  kind: TargetExtensionKind,
  extensionId: string,
  content: string,
): void {
  invariant(
    /^#\s+\S+/mu.test(content),
    `The ${kind} content MUST contain an H1 heading.`,
    { code: 'INVALID_TARGET_AUTHORING_MARKDOWN' },
  )
  invariant(
    !POLICY_FILE_PATTERN.test(content),
    `The ${kind} content MUST NOT reference policy JSON by path.`,
    { code: 'INVALID_TARGET_AUTHORING_MARKDOWN' },
  )

  if (kind === 'command') {
    invariant(
      content.includes('$ARGUMENTS'),
      'A target command MUST use $ARGUMENTS.',
      { code: 'INVALID_TARGET_AUTHORING_MARKDOWN' },
    )
    invariant(
      content.includes(
        `governance card --mode target --extension ${extensionId}`,
      ),
      `A target command MUST run its target governance card for ${extensionId}.`,
      { code: 'INVALID_TARGET_AUTHORING_MARKDOWN' },
    )
  }

  if (kind === 'persona') {
    invariant(
      /^## Responsibilities\s*$/mu.test(content) &&
        /^## Boundaries\s*$/mu.test(content),
      'A target persona MUST contain Responsibilities and Boundaries sections.',
      { code: 'INVALID_TARGET_AUTHORING_MARKDOWN' },
    )
  }
}

export function parseManifest(
  value: unknown,
  source: string,
): TargetExtensionManifest {
  invariant(
    isRecord(value) &&
      value.schema_version === 1 &&
      typeof value.extension_id === 'string' &&
      EXTENSION_ID_PATTERN.test(value.extension_id) &&
      (value.kind === 'command' ||
        value.kind === 'skill' ||
        value.kind === 'persona') &&
      typeof value.title === 'string' &&
      typeof value.summary === 'string' &&
      typeof value.policy_persona === 'string' &&
      Array.isArray(value.policies) &&
      value.policies.every(
        (item) => typeof item === 'string' && POLICY_ID_PATTERN.test(item),
      ) &&
      isRecord(value.context) &&
      typeof value.context.persona === 'string' &&
      value.context.workflow === 'standalone' &&
      typeof value.context.stage === 'string' &&
      typeof value.content_path === 'string' &&
      typeof value.content_sha256 === 'string' &&
      /^[a-f0-9]{64}$/u.test(value.content_sha256),
    `${source} is not a valid target extension manifest.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )

  const manifest = value as unknown as TargetExtensionManifest
  const expectedContentPath =
    `target-extensions/${manifest.extension_id}/` +
    contentFilename(manifest.kind)
  const expectedProjectionPath = projectionRelativePath(
    manifest.kind,
    manifest.extension_id,
  )
  const expectedAgentPath = agentRelativePath(
    manifest.kind,
    manifest.extension_id,
  )

  invariant(
    manifest.context.persona === manifest.policy_persona &&
      manifest.context.stage === `target-${manifest.extension_id}`,
    `${source} context MUST match its extension and policy persona.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )
  invariant(
    manifest.content_path === expectedContentPath,
    `${source}.content_path MUST be ${expectedContentPath}.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )
  invariant(
    new Set(manifest.policies).size === manifest.policies.length,
    `${source}.policies MUST NOT contain duplicates.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )
  invariant(
    !isPancreatorOwnedCursorBasename(`${manifest.extension_id}.md`),
    `${source}.extension_id uses a Pancreator-reserved Cursor basename.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )

  if (expectedProjectionPath === null) {
    invariant(
      manifest.projection_path === undefined &&
        manifest.projection_sha256 === undefined &&
        manifest.agent_path === undefined &&
        manifest.agent_sha256 === undefined &&
        manifest.model === undefined,
      `${source} skill fields MUST NOT declare a model or Cursor projection.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
  } else {
    invariant(
      manifest.projection_path === expectedProjectionPath &&
        typeof manifest.projection_sha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(manifest.projection_sha256),
      `${source} MUST declare its exact Cursor projection and digest.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
    invariant(
      manifest.kind !== 'persona' ||
        (typeof manifest.model === 'string' &&
          manifest.model.trim().length > 0),
      `${source} persona MUST declare a model.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
    invariant(
      manifest.kind !== 'command' || manifest.model === undefined,
      `${source} command MUST NOT declare a model.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
    invariant(
      manifest.kind !== 'command' ||
        (manifest.agent_path === undefined &&
          manifest.agent_sha256 === undefined),
      `${source} command MUST NOT declare a generated agent.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
    invariant(
      manifest.kind !== 'persona' ||
        (manifest.agent_path === expectedAgentPath &&
          manifest.agent_sha256 === manifest.projection_sha256),
      `${source} persona MUST declare its exact generated agent and digest.`,
      { code: 'INVALID_TARGET_EXTENSION' },
    )
  }

  return manifest
}

/** Read one canonical target extension manifest. */
export function readTargetExtensionManifest(
  root: string,
  extensionId: string,
): TargetExtensionManifest {
  invariant(
    EXTENSION_ID_PATTERN.test(extensionId),
    `Invalid target extension id: ${extensionId}`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )

  const relative = manifestRelativePath(extensionId)

  invariant(
    fileExists(path.join(root, relative)),
    `Target extension does not exist: ${extensionId}`,
    { code: 'TARGET_EXTENSION_NOT_FOUND' },
  )

  const manifest = parseManifest(readJson(path.join(root, relative)), relative)

  invariant(
    manifest.extension_id === extensionId,
    `${relative}.extension_id MUST match its directory.`,
    { code: 'INVALID_TARGET_EXTENSION' },
  )

  return manifest
}
