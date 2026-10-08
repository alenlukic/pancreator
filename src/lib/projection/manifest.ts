/**
 * The projection manifest: its schema, the host each target belongs to, and
 * where a root-relative target resolves on disk.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import type { CursorInstallationMode } from '../cursor-content.js'
import { invariant } from '../errors.js'
import { fileExists, isRecord, readJson } from '../io.js'
import {
  PROJECT_HOSTS,
  configuredWorkspaceRoot,
  type ProjectHost,
} from '../project-config.js'

/** `shared` projects for every host; a host name projects only when enabled. */
export type ProjectionHost = 'shared' | ProjectHost

/**
 * Target roots each projection host may write. A shared target MUST be a
 * location every enabled host reads natively.
 */
export const HOST_TARGET_PREFIXES: Record<ProjectionHost, readonly string[]> = {
  shared: ['.agents/skills/'],
  cursor: ['.cursor/'],
  vscode: ['.github/', '.vscode/'],
}

/**
 * `installation-paths` resolves harness path tokens, `policy-rule` renders a
 * policy as a Cursor rule, and `hooks-merge` merges `.cursor/hooks.json`. The
 * VS Code renderers convert a Cursor source: `vscode-instructions` turns a rule
 * into an instruction file, `vscode-agent` a persona into a custom agent, and
 * `skill-command` an operator command into a slash-only skill.
 */
export const PROJECTION_TRANSFORMS = [
  'installation-paths',
  'policy-rule',
  'hooks-merge',
  'vscode-instructions',
  'vscode-agent',
  'skill-command',
] as const

/** Skill folders hold the projected name; every other target is a file. */
export const SKILLS_ROOTS = ['.agents/skills/', '.github/skills/'] as const

/**
 * The name a target claims in its host directory: the skill folder under a
 * skills root, else the file basename. It MUST carry the `pan` namespace in a
 * target repository.
 */
export function projectionOwnedName(target: string): string {
  const root = SKILLS_ROOTS.find((prefix) => target.startsWith(prefix))

  return root
    ? (target.slice(root.length).split('/')[0] ?? '')
    : path.basename(target)
}

export interface ProjectionDefinition {
  id: string
  host: ProjectionHost
  /** Why a host-bound target cannot be shared; absent for a shared target. */
  format_difference: string | null
  source: string
  target: string
  installation_modes: CursorInstallationMode[]
  generated_fields: string[]
  transforms: string[]
}

export interface ProjectionManifest {
  schema_version: 3
  policy: string
  regeneration_command: string
  projections: ProjectionDefinition[]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

export function readProjectionManifest(root: string): ProjectionManifest {
  const manifestPath = path.join(
    root,
    'governance',
    'registries',
    'projection_manifest.json',
  )
  const value = readJson(manifestPath)

  invariant(
    isRecord(value) && value.schema_version === 3,
    'projection manifest schema_version MUST be 3',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    value.policy === 'CONTRACT-001',
    'projection manifest policy MUST be CONTRACT-001',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    typeof value.regeneration_command === 'string' &&
      value.regeneration_command.length > 0,
    'projection manifest regeneration_command MUST be non-empty',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )
  invariant(
    Array.isArray(value.projections),
    'projection manifest projections MUST be an array',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )

  const projections = value.projections.map((entry, index) => {
    invariant(isRecord(entry), `projection ${index} MUST be an object`, {
      code: 'INVALID_PROJECTION_MANIFEST',
    })
    invariant(
      typeof entry.id === 'string' && entry.id.length > 0,
      `projection ${index}.id MUST be non-empty`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      typeof entry.source === 'string' && entry.source.length > 0,
      `projection ${entry.id}.source MUST be non-empty`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      entry.host === 'shared' ||
        (PROJECT_HOSTS as readonly unknown[]).includes(entry.host),
      `projection ${entry.id}.host MUST be shared or one of ${PROJECT_HOSTS.join(', ')}`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )

    const host = entry.host as ProjectionHost
    const prefixes = HOST_TARGET_PREFIXES[host]
    const target = typeof entry.target === 'string' ? entry.target : ''
    const source = entry.source

    invariant(
      prefixes.some((prefix) => target.startsWith(prefix)),
      `projection ${entry.id}.target MUST be under ${prefixes.join(' or ')}`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      !Object.values(HOST_TARGET_PREFIXES)
        .flat()
        .some((prefix) => source.startsWith(prefix)),
      `projection ${entry.id}.source MUST NOT be a projection target`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      host === 'shared'
        ? entry.format_difference === undefined
        : typeof entry.format_difference === 'string' &&
            entry.format_difference.length > 0,
      `projection ${entry.id}.format_difference MUST name why a host-bound target cannot be shared, and only a host-bound target carries one`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )

    const installationModes = stringArray(entry.installation_modes)
    const generatedFields = stringArray(entry.generated_fields)
    const transforms = stringArray(entry.transforms)

    const sourceVariables = [...entry.source.matchAll(/\{([a-z_]+)\}/gu)].map(
      (match) => match[1],
    )
    const targetVariables = [...target.matchAll(/\{([a-z_]+)\}/gu)].map(
      (match) => match[1],
    )

    invariant(
      installationModes.length > 0 &&
        installationModes.every(
          (mode) => mode === 'self_development' || mode === 'embedded',
        ),
      `projection ${entry.id}.installation_modes MUST contain supported modes`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      generatedFields.every((field) => field === 'frontmatter.model'),
      `projection ${entry.id}.generated_fields contains an unsupported field`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      transforms.every((transform) =>
        (PROJECTION_TRANSFORMS as readonly string[]).includes(transform),
      ),
      `projection ${entry.id}.transforms contains an unsupported transform`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )
    invariant(
      sourceVariables.length <= 1 &&
        targetVariables.length === sourceVariables.length &&
        sourceVariables.every(
          (variable, variableIndex) =>
            variable === targetVariables[variableIndex],
        ),
      `projection ${entry.id} source and target variables MUST match`,
      { code: 'INVALID_PROJECTION_MANIFEST' },
    )

    return {
      id: entry.id,
      host,
      format_difference:
        typeof entry.format_difference === 'string'
          ? entry.format_difference
          : null,
      source: entry.source,
      target,
      installation_modes: installationModes as CursorInstallationMode[],
      generated_fields: generatedFields,
      transforms,
    }
  })

  invariant(
    new Set(projections.map((projection) => projection.id)).size ===
      projections.length,
    'projection manifest ids MUST be unique',
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )

  return {
    schema_version: 3,
    policy: value.policy,
    regeneration_command: value.regeneration_command,
    projections,
  }
}

export function expandProjection(
  root: string,
  projection: ProjectionDefinition,
): Array<{ source: string; target: string; variable: string | null }> {
  const match = /\{([a-z_]+)\}/u.exec(projection.source)

  if (!match) {
    return [
      {
        source: projection.source,
        target: projection.target,
        variable: null,
      },
    ]
  }

  const token = match[0]
  const sourceDirectory = path.dirname(projection.source)
  const basename = path.basename(projection.source)
  const [prefix, suffix] = basename.split(token)

  const absoluteDirectory = path.join(root, sourceDirectory)

  if (!fileExists(absoluteDirectory)) {
    return []
  }

  return readdirSync(absoluteDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix ?? '') &&
        entry.name.endsWith(suffix ?? ''),
    )
    .map((entry) => {
      const variable = entry.name.slice(
        (prefix ?? '').length,
        entry.name.length - (suffix ?? '').length,
      )

      return {
        source: projection.source.replace(token, variable),
        target: projection.target.replace(token, variable),
        variable,
      }
    })
    .sort((left, right) => left.target.localeCompare(right.target))
}

export function projectsForHosts(
  projection: ProjectionDefinition,
  hosts: readonly ProjectHost[],
): boolean {
  return projection.host === 'shared' || hosts.includes(projection.host)
}

/**
 * Absolute path of a root-relative projection target. A `.cursor/` target
 * resolves through the harness root, which links `.cursor` to the target
 * repository's copy in an embedded installation. Every other host target has
 * no such link and resolves against the configured workspace root.
 */
export function projectionTargetPath(root: string, target: string): string {
  return target.startsWith('.cursor/')
    ? path.join(root, target)
    : path.resolve(root, configuredWorkspaceRoot(root), target)
}
