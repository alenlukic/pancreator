/**
 * Repository validation of published target extensions against their
 * manifests, projections, and clone-local exclusions.
 */

import path from 'node:path'

import {
  fileExists,
  readText,
  sha256,
  readJson,
  writeJsonAtomic,
  writeTextAtomic,
} from '../io.js'
import { resolvePolicies } from '../policies.js'
import { isTargetInstallation } from '../project-config.js'
import {
  readTargetExtensionManifest,
  targetRoot,
  type TargetAuthoringDraft,
  type TargetAuthoringValidationResult,
  type TargetExtensionManifest,
} from './manifest.js'
import {
  bindingFor,
  listManifests,
  renderProjection,
  targetExclusionState,
  updateTargetExclusions,
} from './apply.js'

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
  const state = targetExclusionState(root, workspace)

  if (state && state.desired !== state.previous) {
    errors.push('target extension clone-local exclusions are missing or stale')
  }
}
