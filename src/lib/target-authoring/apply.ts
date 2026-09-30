/**
 * Apply one authoring draft: render its persona agent and command projection,
 * resolve its policies, write its manifest, and keep the clone-local Git
 * exclusions of every published extension current.
 */

import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'

import { projectCursorContent } from '../cursor-content.js'
import { invariant } from '../errors.js'
import { createCursorModelResolver } from '../executors/cursor-catalog.js'
import { parsePersonaMapping } from '../executors/mapping.js'
import {
  fileExists,
  readJson,
  sha256,
  isDirectory,
  readText,
  ensureDir,
  writeTextAtomic,
  resolveInside,
  writeJsonAtomic,
} from '../io.js'
import {
  loadPolicySources,
  resolvePolicies,
  loadPolicyCatalog,
} from '../policies.js'
import { harnessPathPrefix, isTargetInstallation } from '../project-config.js'
import {
  EXCLUDE_BEGIN,
  EXCLUDE_END,
  agentRelativePath,
  contentFilename,
  extensionDirectory,
  installationMode,
  manifestRelativePath,
  parseDraft,
  parseManifest,
  projectionRelativePath,
  readTargetExtensionManifest,
  targetRoot,
  type TargetAuthoringApplyResult,
  type TargetAuthoringDraft,
  type TargetExtensionManifest,
} from './manifest.js'

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

/**
 * Render the Cursor file a target extension draft projects into the target: the
 * command Markdown for a command, or the generated agent file with its resolved
 * Cursor model for a persona. Returns null for a skill, which has no
 * projection. Throws `PanError` `TARGET_AUTHORING_UNAVAILABLE` outside a target
 * installation, and when the persona's model mapping does not resolve.
 */
export function renderProjection(
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

/**
 * Return the policy lookup extension document a target extension manifest
 * implies: one row binding the manifest's policies to its standalone context.
 * Written to `governance/registries/policy_lookup.d/<extension-id>.json` and
 * compared against it to detect drift.
 */
export function bindingFor(manifest: TargetExtensionManifest): unknown {
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

/**
 * Read and validate the manifest of every directory under `target-extensions/`,
 * sorted by name. Returns an empty list when the directory is absent; throws
 * when a manifest is missing or invalid.
 */
export function listManifests(root: string): TargetExtensionManifest[] {
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

interface TargetExclusionState {
  path: string
  previous: string
  desired: string
}

/**
 * Compute the target clone's `.git/info/exclude` content before and after
 * rewriting the Pancreator block that excludes every target extension
 * projection path. Leaves the file text unchanged when no projection exists and
 * no block was ever written. Returns null when the target root is not a Git
 * repository.
 */
export function targetExclusionState(
  root: string,
  workspace?: string,
): TargetExclusionState | null {
  const excludePath = gitExcludePath(targetRoot(root, workspace))

  if (!excludePath) {
    return null
  }

  const projections = listManifests(root)
    .flatMap((manifest) =>
      manifest.projection_path ? [manifest.projection_path] : [],
    )
    .sort()
  const previous = fileExists(excludePath) ? readText(excludePath) : ''
  // A target that owns no projection and carries no block owns no
  // exclusions. Rendering an empty block anyway reported a valid
  // installation as stale over exclusions it had never written. A target
  // whose last extension went away still carries a block, and that block
  // is stale until the empty render removes it.
  const desired =
    projections.length === 0 && !previous.includes(EXCLUDE_BEGIN)
      ? previous
      : renderExcludeBlock(previous, projections)

  return { path: excludePath, previous, desired }
}

/**
 * Rewrite the Pancreator target extension block in the target clone's
 * `.git/info/exclude` so it lists exactly the current projection paths. Writes
 * only when the content changes; does nothing when the target root is not a Git
 * repository.
 */
export function updateTargetExclusions(root: string, workspace?: string): void {
  const state = targetExclusionState(root, workspace)

  if (!state || state.desired === state.previous) {
    return
  }

  ensureDir(path.dirname(state.path))
  writeTextAtomic(state.path, state.desired)
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

  // The policy binding is part of the published state. Comparing only the
  // manifest and the content reported `unchanged` for an extension whose
  // binding was absent, so `pan author apply` declined to write it back.
  const lookupPath = path.join(
    root,
    'governance',
    'registries',
    'policy_lookup.d',
    `${manifest.extension_id}.json`,
  )

  if (
    !fileExists(lookupPath) ||
    sha256(readJson(lookupPath)) !== sha256(bindingFor(manifest))
  ) {
    return false
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

  // The staleness guard protects an author from overwriting an extension
  // someone else changed. An identical manifest whose derived files went
  // missing is a repair of the author's own published state, not a
  // concurrent change, so it republishes without a fresh expectation.
  if (previous && manifestDigest !== sha256(previous)) {
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
