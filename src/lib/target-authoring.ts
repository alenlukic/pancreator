import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import {
  projectCursorContent,
  type CursorInstallationMode,
} from './cursor-content.js'
import { invariant } from './errors.js'
import { createCursorModelResolver } from './executors/cursor-catalog.js'
import { parsePersonaMapping } from './executors/mapping.js'
import {
  ensureDir,
  fileExists,
  isDirectory,
  isRecord,
  readJson,
  readText,
  resolveInside,
  sha256,
  writeJsonAtomic,
  writeTextAtomic,
} from './io.js'
import {
  loadPolicyCatalog,
  loadPolicySources,
  resolvePolicies,
} from './policies.js'
import {
  configuredWorkspaceRoot,
  harnessPathPrefix,
  isTargetInstallation,
  loadProjectConfig,
} from './project-config.js'
import { isPancreatorOwnedCursorBasename } from './projection.js'

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

interface TargetAuthoringDraft {
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
const EXCLUDE_BEGIN = '# >>> pancreator target extensions >>>'
const EXCLUDE_END = '# <<< pancreator target extensions <<<'

function installationMode(root: string): CursorInstallationMode {
  const mode = loadProjectConfig(root).installation_mode

  invariant(
    mode === 'embedded' || mode === 'detached',
    'Target authoring is available only in embedded or detached installations.',
    { code: 'TARGET_AUTHORING_UNAVAILABLE' },
  )

  return mode
}

function targetRoot(root: string, workspace?: string): string {
  return path.resolve(root, workspace ?? configuredWorkspaceRoot(root))
}

function extensionDirectory(root: string, extensionId: string): string {
  return path.join(root, 'target-extensions', extensionId)
}

function manifestRelativePath(extensionId: string): string {
  return `target-extensions/${extensionId}/manifest.json`
}

function contentFilename(kind: TargetExtensionKind): string {
  return `${kind}.md`
}

function projectionRelativePath(
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

function agentRelativePath(
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

function parseDraft(value: unknown, source: string): TargetAuthoringDraft {
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

function parseManifest(
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

function renderPersonaAgent(
  root: string,
  draft: TargetAuthoringDraft,
  model: string,
): string {
  const source = [
    '---',
    `description: ${draft.summary.replaceAll('\n', ' ')}`,
    `model: ${model}`,
    '---',
    '',
    `# ${draft.title}`,
    '',
    `Run \`${draft.extension_id}\` under its target-owned persona contract.`,
    '',
    `1. Read \`{{PANCREATOR_HARNESS_PATH}}AGENTS.md\`.`,
    `2. Run \`{{PANCREATOR_PAN_COMMAND}} governance card --mode target --extension ${draft.extension_id}\` and read the card in full.`,
    `3. Read \`{{PANCREATOR_HARNESS_PATH}}target-extensions/${draft.extension_id}/persona.md\` and obey it.`,
    '',
  ].join('\n')

  return projectCursorContent(
    source,
    `.cursor/agents/${draft.extension_id}.md`,
    installationMode(root),
    harnessPathPrefix(root),
  )
}

function renderProjection(
  root: string,
  draft: TargetAuthoringDraft,
): string | null {
  if (draft.kind === 'skill') {
    return null
  }

  if (draft.kind === 'command') {
    return projectCursorContent(
      draft.content,
      `.cursor/commands/${draft.extension_id}.md`,
      installationMode(root),
      harnessPathPrefix(root),
    )
  }

  const mapping = parsePersonaMapping(
    draft.model ?? '',
    `target persona ${draft.extension_id}`,
  )
  const model = createCursorModelResolver(root)(
    mapping,
    `target persona ${draft.extension_id}`,
  )

  return renderPersonaAgent(root, draft, model)
}

function bindingFor(manifest: TargetExtensionManifest): unknown {
  return {
    schema_version: 1,
    extension_id: manifest.extension_id,
    policies: [],
    rows: [
      {
        ...manifest.context,
        policies: manifest.policies,
      },
    ],
  }
}

function existingManifest(
  root: string,
  extensionId: string,
): TargetExtensionManifest | null {
  const manifestPath = path.join(root, manifestRelativePath(extensionId))

  return fileExists(manifestPath)
    ? parseManifest(readJson(manifestPath), manifestRelativePath(extensionId))
    : null
}

function resolvedPolicyIds(
  root: string,
  draft: TargetAuthoringDraft,
  previous: TargetExtensionManifest | null,
): string[] {
  const context = {
    persona: draft.policy_persona,
    workflow: 'standalone',
    stage: `target-${draft.extension_id}`,
  } as const
  const sources = loadPolicySources(root)

  if (previous) {
    sources.lookup = {
      ...sources.lookup,
      rows: sources.lookup.rows.filter(
        (row) =>
          !(
            row.persona === previous.context.persona &&
            row.workflow === previous.context.workflow &&
            row.stage === previous.context.stage &&
            JSON.stringify(row.policies) === JSON.stringify(previous.policies)
          ),
      ),
    }
  }

  const resolved = resolvePolicies(
    root,
    {
      ...context,
      operator_artifacts: 'suppressed',
    },
    sources,
  ).map((policy) => policy.id)
  const catalog = loadPolicyCatalog(root)

  for (const policyId of draft.policies) {
    invariant(catalog.has(policyId), `Unknown policy: ${policyId}`, {
      code: 'UNKNOWN_TARGET_POLICY',
    })
  }

  return [...new Set([...resolved, ...draft.policies])].sort()
}

function manifestFor(
  draft: TargetAuthoringDraft,
  policies: string[],
  projection: string | null,
): TargetExtensionManifest {
  const contentPath = `target-extensions/${draft.extension_id}/${contentFilename(draft.kind)}`
  const projectionPath = projectionRelativePath(draft.kind, draft.extension_id)
  const agentPath = agentRelativePath(draft.kind, draft.extension_id)
  const projectionSha256 = projection
    ? sha256(projection.endsWith('\n') ? projection : `${projection}\n`)
    : null

  return {
    schema_version: 1,
    extension_id: draft.extension_id,
    kind: draft.kind,
    title: draft.title,
    summary: draft.summary,
    policy_persona: draft.policy_persona,
    policies,
    context: {
      persona: draft.policy_persona,
      workflow: 'standalone',
      stage: `target-${draft.extension_id}`,
    },
    content_path: contentPath,
    content_sha256: sha256(
      draft.content.endsWith('\n') ? draft.content : `${draft.content}\n`,
    ),
    ...(draft.model ? { model: draft.model } : {}),
    ...(agentPath && projectionSha256
      ? {
          agent_path: agentPath,
          agent_sha256: projectionSha256,
        }
      : {}),
    ...(projectionPath && projection
      ? {
          projection_path: projectionPath,
          projection_sha256: projectionSha256 ?? undefined,
        }
      : {}),
  }
}

function listManifests(root: string): TargetExtensionManifest[] {
  const directory = path.join(root, 'target-extensions')

  if (!isDirectory(directory)) {
    return []
  }

  const manifests: TargetExtensionManifest[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  )) {
    if (!entry.isDirectory()) {
      continue
    }

    manifests.push(readTargetExtensionManifest(root, entry.name))
  }

  return manifests
}

function gitExcludePath(workspace: string): string | null {
  const result = spawnSync(
    'git',
    ['-C', workspace, 'rev-parse', '--absolute-git-dir'],
    {
      encoding: 'utf8',
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    },
  )

  return result.status === 0
    ? path.join(result.stdout.trim(), 'info', 'exclude')
    : null
}

function renderExcludeBlock(
  previous: string,
  projectionPaths: string[],
): string {
  const lines = previous.split(/\r?\n/u)
  const kept: string[] = []
  let skipping = false

  for (const line of lines) {
    if (line === EXCLUDE_BEGIN) {
      skipping = true
      continue
    }

    if (line === EXCLUDE_END) {
      skipping = false
      continue
    }

    if (!skipping) {
      kept.push(line)
    }
  }

  while (kept.length > 0 && kept.at(-1)?.trim() === '') {
    kept.pop()
  }

  return [
    ...kept,
    ...(kept.length > 0 ? [''] : []),
    EXCLUDE_BEGIN,
    ...projectionPaths.map((item) => `/${item}`),
    EXCLUDE_END,
    '',
  ].join('\n')
}

function updateTargetExclusions(root: string, workspace?: string): void {
  const workspaceRoot = targetRoot(root, workspace)
  const excludePath = gitExcludePath(workspaceRoot)

  if (!excludePath) {
    return
  }

  const projections = listManifests(root)
    .flatMap((manifest) =>
      manifest.projection_path ? [manifest.projection_path] : [],
    )
    .sort()
  const previous = fileExists(excludePath) ? readText(excludePath) : ''

  ensureDir(path.dirname(excludePath))
  writeTextAtomic(excludePath, renderExcludeBlock(previous, projections))
}

function samePublishedState(
  root: string,
  manifest: TargetExtensionManifest,
  previous: TargetExtensionManifest,
  projection: string | null,
  workspace?: string,
): boolean {
  if (sha256(manifest) !== sha256(previous)) {
    return false
  }

  if (!fileExists(path.join(root, manifest.content_path))) {
    return false
  }

  const content = readText(path.join(root, manifest.content_path))

  if (sha256(content) !== manifest.content_sha256) {
    return false
  }

  if (manifest.agent_path && projection) {
    const agentPath = path.join(root, manifest.agent_path)

    if (
      !fileExists(agentPath) ||
      sha256(readText(agentPath)) !== manifest.agent_sha256
    ) {
      return false
    }
  }

  if (manifest.projection_path && projection) {
    const projectedPath = path.join(
      targetRoot(root, workspace),
      manifest.projection_path,
    )

    return (
      fileExists(projectedPath) &&
      sha256(readText(projectedPath)) === manifest.projection_sha256
    )
  }

  return true
}

/** Validate and atomically publish one target-owned extension draft. */
export function applyTargetAuthoringDraft(
  root: string,
  inputPath: string,
  options: { workspace?: string } = {},
): TargetAuthoringApplyResult {
  invariant(
    isTargetInstallation(root),
    'Target authoring requires a target installation.',
    {
      code: 'TARGET_AUTHORING_UNAVAILABLE',
    },
  )
  installationMode(root)

  const draft = parseDraft(readJson(resolveInside(root, inputPath)), inputPath)
  const previous = existingManifest(root, draft.extension_id)
  const policies = resolvedPolicyIds(root, draft, previous)
  const projection = renderProjection(root, draft)
  const manifest = manifestFor(draft, policies, projection)
  const manifestDigest = sha256(manifest)

  if (
    previous &&
    samePublishedState(root, manifest, previous, projection, options.workspace)
  ) {
    updateTargetExclusions(root, options.workspace)

    return resultFor(manifest, manifestDigest, 'unchanged')
  }

  if (previous) {
    invariant(
      draft.expected_manifest_sha256 === sha256(previous),
      `Target extension ${draft.extension_id} changed since the draft was prepared.`,
      { code: 'STALE_TARGET_AUTHORING_DRAFT' },
    )
  }

  const extensionRoot = extensionDirectory(root, draft.extension_id)

  ensureDir(extensionRoot)
  writeTextAtomic(path.join(root, manifest.content_path), draft.content)
  if (manifest.agent_path && projection) {
    writeTextAtomic(path.join(root, manifest.agent_path), projection)
  }
  writeJsonAtomic(
    path.join(
      root,
      'governance',
      'registries',
      'policy_lookup.d',
      `${draft.extension_id}.json`,
    ),
    bindingFor(manifest),
  )

  if (manifest.projection_path && projection) {
    writeTextAtomic(
      path.join(targetRoot(root, options.workspace), manifest.projection_path),
      projection,
    )
  }

  writeJsonAtomic(
    path.join(root, manifestRelativePath(draft.extension_id)),
    manifest,
  )
  updateTargetExclusions(root, options.workspace)

  return resultFor(manifest, manifestDigest, 'applied')
}

function resultFor(
  manifest: TargetExtensionManifest,
  manifestDigest: string,
  status: TargetAuthoringApplyResult['status'],
): TargetAuthoringApplyResult {
  return {
    status,
    extension_id: manifest.extension_id,
    manifest_path: manifestRelativePath(manifest.extension_id),
    content_path: manifest.content_path,
    lookup_path: `governance/registries/policy_lookup.d/${manifest.extension_id}.json`,
    projection_path: manifest.projection_path ?? null,
    manifest_sha256: manifestDigest,
    policies: manifest.policies,
  }
}

function expectedProjectionFromManifest(
  root: string,
  manifest: TargetExtensionManifest,
  content: string,
): string | null {
  const draft: TargetAuthoringDraft = {
    schema_version: 1,
    extension_id: manifest.extension_id,
    kind: manifest.kind,
    title: manifest.title,
    summary: manifest.summary,
    content,
    policy_persona: manifest.policy_persona,
    policies: manifest.policies,
    ...(manifest.model ? { model: manifest.model } : {}),
  }

  return renderProjection(root, draft)
}

function validateOne(
  root: string,
  manifest: TargetExtensionManifest,
  repair: boolean,
  errors: string[],
  workspace?: string,
): void {
  const contentPath = path.join(root, manifest.content_path)

  if (!fileExists(contentPath)) {
    errors.push(`${manifest.extension_id}: missing ${manifest.content_path}`)
    return
  }

  const content = readText(contentPath)

  if (sha256(content) !== manifest.content_sha256) {
    errors.push(`${manifest.extension_id}: canonical content digest mismatch`)
    return
  }

  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup.d',
    `${manifest.extension_id}.json`,
  )
  const expectedBinding = bindingFor(manifest)

  if (
    repair ||
    !fileExists(lookupPath) ||
    sha256(readJson(lookupPath)) !== sha256(expectedBinding)
  ) {
    if (repair) {
      writeJsonAtomic(lookupPath, expectedBinding)
    } else {
      errors.push(
        `${manifest.extension_id}: policy binding is missing or stale`,
      )
    }
  }

  const expectedProjection = expectedProjectionFromManifest(
    root,
    manifest,
    content,
  )

  if (manifest.projection_path && expectedProjection) {
    if (sha256(expectedProjection) !== manifest.projection_sha256) {
      errors.push(`${manifest.extension_id}: projected content digest mismatch`)
      return
    }

    const projectionPath = path.join(
      targetRoot(root, workspace),
      manifest.projection_path,
    )

    if (
      repair ||
      !fileExists(projectionPath) ||
      sha256(readText(projectionPath)) !== manifest.projection_sha256
    ) {
      if (repair) {
        writeTextAtomic(projectionPath, expectedProjection)
      } else {
        errors.push(
          `${manifest.extension_id}: Cursor projection is missing or stale`,
        )
      }
    }
  }

  if (manifest.agent_path && expectedProjection) {
    if (
      repair ||
      !fileExists(path.join(root, manifest.agent_path)) ||
      sha256(readText(path.join(root, manifest.agent_path))) !==
        manifest.agent_sha256
    ) {
      if (repair) {
        writeTextAtomic(
          path.join(root, manifest.agent_path),
          expectedProjection,
        )
      } else {
        errors.push(
          `${manifest.extension_id}: generated agent is missing or stale`,
        )
      }
    }
  }

  try {
    const resolved = resolvePolicies(root, {
      ...manifest.context,
      operator_artifacts: 'suppressed',
    }).map((policy) => policy.id)

    for (const policyId of manifest.policies) {
      if (!resolved.includes(policyId)) {
        errors.push(
          `${manifest.extension_id}: policy ${policyId} does not resolve`,
        )
      }
    }
  } catch (error) {
    errors.push(`${manifest.extension_id}: ${String(error)}`)
  }
}

/**
 * Validate target extensions. The CLI repair path restores derived bindings,
 * projections, and clone-local exclusions from canonical manifests.
 */
export function validateTargetAuthoring(
  root: string,
  options: {
    extensionId?: string
    repair?: boolean
    workspace?: string
  } = {},
): TargetAuthoringValidationResult {
  if (!isTargetInstallation(root)) {
    return { ok: true, errors: [], extensions: [] }
  }

  const errors: string[] = []
  let manifests: TargetExtensionManifest[] = []

  try {
    manifests = options.extensionId
      ? [readTargetExtensionManifest(root, options.extensionId)]
      : listManifests(root)

    for (const manifest of manifests) {
      validateOne(
        root,
        manifest,
        options.repair === true,
        errors,
        options.workspace,
      )
    }

    if (options.repair) {
      updateTargetExclusions(root, options.workspace)
    } else {
      validateTargetExclusions(root, errors, options.workspace)
    }
  } catch (error) {
    errors.push(String(error))
  }

  return {
    ok: errors.length === 0,
    errors,
    extensions: manifests.map((manifest) => manifest.extension_id).sort(),
  }
}

function validateTargetExclusions(
  root: string,
  errors: string[],
  workspace?: string,
): void {
  const excludePath = gitExcludePath(targetRoot(root, workspace))

  if (!excludePath) {
    return
  }

  const projections = listManifests(root)
    .flatMap((manifest) =>
      manifest.projection_path ? [manifest.projection_path] : [],
    )
    .sort()
  const previous = fileExists(excludePath) ? readText(excludePath) : ''

  if (renderExcludeBlock(previous, projections) !== previous) {
    errors.push('target extension clone-local exclusions are missing or stale')
  }
}
