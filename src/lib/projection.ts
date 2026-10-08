import { readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

import {
  projectCursorContent,
  renderPolicyCursorRule,
  type CursorInstallationMode,
} from './cursor-content.js'
import { invariant } from './errors.js'
import { parsePersonaMapping } from './executors/mapping.js'
import { createCursorModelResolver } from './executors/cursor-catalog.js'
import { loadPolicyCatalog } from './policies.js'
import { policySectionDigest } from './policy-guidance.js'
import type { Policy, PolicyDelivery } from './types.js'
import { fileExists, readText, sha256, writeTextAtomic } from './io.js'
import {
  loadPipelineConfig,
  type LoadedPipelineConfig,
} from './pipeline-config.js'
import {
  PROJECT_HOSTS,
  enabledHosts,
  harnessPathPrefix,
  loadProjectConfig,
  panCommand,
  type ProjectHost,
} from './project-config.js'
import { mergeCursorHooksText } from './cursor-hooks-merge.js'
import { gitTracksFile } from './git/core.js'
import { hostToolTranslations, loadHostToolRegistry } from './host-tools.js'
import {
  renderCommandSkill,
  renderVscodeAgent,
  renderVscodeInstructions,
  translateHostToolNames,
} from './projection/host-content.js'
import {
  SKILLS_ROOTS,
  expandProjection,
  projectionOwnedName,
  projectionTargetPath,
  projectsForHosts,
  readProjectionManifest,
} from './projection/manifest.js'
import { sweepableCandidates } from './projection/sweep.js'

function variableFor(id: string, variable: string | null): string {
  invariant(variable !== null, `projection ${id} requires a name variable`, {
    code: 'INVALID_PROJECTION_MANIFEST',
  })

  return variable
}

export {
  projectionTargetPath,
  type ProjectionHost,
} from './projection/manifest.js'

/** Filenames Pancreator may own inside a target repository's `.cursor/`. */
const PANCREATOR_OWNED_BASENAME = /^pan(-|creator\.)/u

/**
 * Projection directories whose `pan`-namespaced files Pancreator owns. A full
 * sync removes each such file no enabled projection renders, which is also how
 * disabling a host removes that host's projections.
 */
const PANCREATOR_OWNED_DIRECTORIES = [
  '.cursor/agents',
  '.cursor/commands',
  '.cursor/rules',
  '.github/agents',
  '.github/hooks',
  '.github/instructions',
  '.github/skills',
  '.agents/skills',
] as const

function isSkillsDirectory(relativeDirectory: string): boolean {
  return SKILLS_ROOTS.some((root) => root === `${relativeDirectory}/`)
}

/**
 * Remove each non-Cursor owned directory a sync left empty, then its parent
 * when that is empty too. An empty directory carries no target content, and
 * `.cursor/` keeps its existing layout.
 */
function pruneEmptyHostDirectories(root: string): void {
  for (const relativeDirectory of PANCREATOR_OWNED_DIRECTORIES) {
    if (relativeDirectory.startsWith('.cursor/')) {
      continue
    }

    const directory = projectionTargetPath(root, relativeDirectory)

    for (const candidate of [directory, path.dirname(directory)]) {
      if (fileExists(candidate) && readdirSync(candidate).length === 0) {
        rmSync(candidate, { recursive: true, force: true })
      }
    }
  }
}

/** A removed skill leaves its `pan-*` folder behind unless it is now empty. */
function removeEmptySkillFolder(target: string, targetPath: string): void {
  const folder = path.dirname(targetPath)

  if (
    SKILLS_ROOTS.some((root) => target.startsWith(root)) &&
    fileExists(folder) &&
    readdirSync(folder).length === 0
  ) {
    rmSync(folder, { recursive: true, force: true })
  }
}

/** True when a Cursor basename belongs to Pancreator's reserved namespace. */
export function isPancreatorOwnedCursorBasename(basename: string): boolean {
  return PANCREATOR_OWNED_BASENAME.test(basename)
}

/**
 * Separator between a persona and a run-scoped variant suffix. Two hyphens keep
 * a variant filename distinguishable from a persona whose own name contains a
 * hyphen, such as `design-qa`.
 */
const VARIANT_SEPARATOR = '--'

interface RenderedProjection {
  id: string
  source: string
  target: string
  content: string
}

export interface CursorProjectionSource {
  id: string
  source: string
  path: string
  content: string
}

export interface CursorProjectionChange {
  id: string
  source: string
  path: string
  changed: boolean
  previous_sha256: string | null
  sha256: string
  /**
   * Marks a stale projected file whose persona moved to an external executor.
   * `changed` is true while the file still exists; a sync removes it.
   */
  removed?: boolean
}

export interface ProjectionDriftResult {
  errors: string[]
  regeneration_command: string
}

/** Resolve the policy a `policy-rule` projection generates from. */
function policyForProjection(root: string, source: string): Policy {
  const policyId = path.basename(source, '.json')
  const policy = loadPolicyCatalog(root).get(policyId)

  invariant(policy, `policy-rule projection references missing ${policyId}`, {
    code: 'INVALID_PROJECTION_MANIFEST',
  })

  return policy
}

function installationMode(root: string): CursorInstallationMode {
  return loadProjectConfig(root).installation_mode ?? 'self_development'
}

/**
 * Mode the manifest is filtered by. A detached installation projects the same
 * file set as an embedded one — only the harness prefix baked into the content
 * differs — so the manifest declares `embedded` for both.
 */
function projectionMode(
  mode: CursorInstallationMode,
): Exclude<CursorInstallationMode, 'detached'> {
  return mode === 'detached' ? 'embedded' : mode
}

/**
 * The always-apply rule each projected policy reaches a `host` session
 * through in `mode`, keyed by policy id.
 */
export function projectedPolicyRuleTargets(
  root: string,
  mode: CursorInstallationMode = installationMode(root),
  host: ProjectHost = 'cursor',
): Map<string, string> {
  const projected = projectionMode(mode)
  const targets = new Map<string, string>()

  for (const projection of readProjectionManifest(root).projections) {
    if (
      projection.host === host &&
      projection.transforms.includes('policy-rule') &&
      projection.installation_modes.includes(projected)
    ) {
      targets.set(path.basename(projection.source, '.json'), projection.target)
    }
  }

  return targets
}

/**
 * The host whose projected instructions an in-host worker reads, or null
 * when the session cannot tell. `PAN_HOST` names it outright, a Cursor
 * conversation id marks a Cursor session, and a single enabled host leaves
 * no doubt.
 */
export function workerCardHost(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): ProjectHost | null {
  const named = env.PAN_HOST

  if ((PROJECT_HOSTS as readonly unknown[]).includes(named)) {
    return named as ProjectHost
  }

  if (named !== undefined && named !== '') {
    return null
  }

  if ((env.CURSOR_CONVERSATION_ID ?? '') !== '') {
    return 'cursor'
  }

  const hosts = enabledHosts(root)

  return hosts.length === 1 ? (hosts[0] as ProjectHost) : null
}

/**
 * How each policy reaches a worker card, keyed by policy id.
 *
 * An in-host worker already receives every projected policy as an
 * always-apply instruction of its host, so its card carries a digest pointer
 * for those policies instead of a second copy. A Cursor session reads
 * `.cursor/rules`; a VS Code session reads `.github/instructions`, and a
 * policy whose VS Code file is not projected stays inline. An external
 * executor, or a session whose host is unknown (`host: null`), receives every
 * policy inline. An unreadable manifest inlines everything rather than point
 * at a rule that may not exist.
 */
export function policyDeliveryPlan(
  root: string,
  policies: Policy[],
  options: {
    executor: string
    mode: CursorInstallationMode
    host?: ProjectHost | null
  },
): Record<string, PolicyDelivery> {
  const host = options.host === undefined ? 'cursor' : options.host
  let targets = new Map<string, string>()

  if (options.executor === 'cursor' && host !== null) {
    try {
      targets = projectedPolicyRuleTargets(root, options.mode, host)
    } catch {
      targets = new Map()
    }

    if (host !== 'cursor') {
      targets = new Map(
        [...targets].filter(([, target]) =>
          fileExists(projectionTargetPath(root, target)),
        ),
      )
    }
  }

  return Object.fromEntries(
    policies.map((policy): [string, PolicyDelivery] => {
      const target = targets.get(policy.id)

      return [
        policy.id,
        target
          ? {
              mode: 'pointer',
              target,
              sha256: policySectionDigest(policy, 'agent'),
              host: host as ProjectHost,
            }
          : { mode: 'inline' },
      ]
    }),
  )
}

interface ProjectionRemoval {
  id: string
  source: string
  target: string
}

export interface RenderProjectionsOptions {
  /** Render only these projection ids. Omit to render every declared one. */
  only?: readonly string[]
  /** A pipeline config the caller already loaded, to skip a second load. */
  pipeline?: LoadedPipelineConfig
  /** Project configured specs without the local Cursor model catalog. */
  skipCatalog?: boolean
  /** Merge canonical hooks against the local target. */
  mergeHooks?: boolean
}

function renderProjections(
  root: string,
  options: RenderProjectionsOptions = {},
): {
  rendered: RenderedProjection[]
  removals: ProjectionRemoval[]
} {
  const manifest = readProjectionManifest(root)
  const mode = installationMode(root)
  const manifestMode = projectionMode(mode)
  const harnessPrefix = harnessPathPrefix(root)
  const hosts = enabledHosts(root)

  const pipeline =
    options.pipeline ??
    loadPipelineConfig(root, undefined, { skipCatalog: options.skipCatalog })
  const resolveModel = createCursorModelResolver(root, {
    skipCatalog: options.skipCatalog,
  })
  const only = options.only === undefined ? null : new Set(options.only)

  const rendered: RenderedProjection[] = []
  const removals: ProjectionRemoval[] = []

  for (const projection of manifest.projections) {
    if (
      !projection.installation_modes.includes(manifestMode) ||
      !projectsForHosts(projection, hosts)
    ) {
      continue
    }

    if (only !== null && !only.has(projection.id)) {
      continue
    }

    for (const entry of expandProjection(root, projection)) {
      const absoluteSource = path.join(root, entry.source)

      invariant(
        fileExists(absoluteSource),
        `Missing projection source: ${entry.source}`,
        {
          code: 'INVALID_PROJECTION_MANIFEST',
        },
      )

      // A target repository owns its own `.cursor/` surface. Every file
      // Pancreator installs there MUST carry the `pan` namespace so a
      // projection can never collide with a target-authored agent, command, or
      // rule. Checked post-expansion so a mis-named source is caught too.
      // Self-development is exempt: that workspace is Pancreator's own, and
      // Cursor fixes some filenames (`mcp.json`) that cannot be namespaced.
      invariant(
        !projection.installation_modes.includes('embedded') ||
          PANCREATOR_OWNED_BASENAME.test(projectionOwnedName(entry.target)) ||
          projection.transforms.includes('hooks-merge'),
        `projection ${projection.id} target MUST use a pan-namespaced filename: ${entry.target}`,
        { code: 'INVALID_PROJECTION_MANIFEST' },
      )

      let content = projection.transforms.includes('policy-rule')
        ? renderPolicyCursorRule(policyForProjection(root, entry.source))
        : readText(absoluteSource)

      if (projection.generated_fields.includes('frontmatter.model')) {
        invariant(
          entry.variable !== null,
          `projection ${projection.id} requires a persona variable`,
          { code: 'INVALID_PROJECTION_MANIFEST' },
        )

        const model = pipeline.config.personas[entry.variable]

        invariant(
          typeof model === 'string' && model.length > 0,
          `Pipeline config does not map projection persona '${entry.variable}'.`,
          { code: 'INVALID_PIPELINE_CONFIG' },
        )

        const mapping = parsePersonaMapping(model, entry.variable)

        // An external-executor persona has no Cursor subagent, so nothing is
        // projected for it — and a previously projected file is stale: leaving
        // it in place would record a false model claim for work Cursor no
        // longer performs.
        if (mapping.executor !== 'cursor') {
          removals.push({
            id: projection.id,
            source: entry.source,
            target: entry.target,
          })
          continue
        }

        invariant(
          content.includes('__PANCREATOR_MODEL__'),
          `${entry.source} MUST contain __PANCREATOR_MODEL__.`,
          { code: 'INVALID_CURSOR_AGENT' },
        )

        content = content.replaceAll(
          '__PANCREATOR_MODEL__',
          resolveModel(mapping, entry.variable),
        )
      }

      if (projection.transforms.includes('installation-paths')) {
        content = projectCursorContent(
          content,
          entry.target,
          mode,
          harnessPrefix,
        )
      }

      if (projection.transforms.includes('vscode-instructions')) {
        content = renderVscodeInstructions(content)
      }

      if (projection.transforms.includes('vscode-agent')) {
        content = renderVscodeAgent(
          variableFor(projection.id, entry.variable),
          content,
        )
      }

      if (projection.transforms.includes('skill-command')) {
        content = renderCommandSkill(
          variableFor(projection.id, entry.variable),
          content,
        )
      }

      if (projection.host !== 'cursor' && projection.host !== 'shared') {
        content = translateHostToolNames(
          content,
          hostToolTranslations(loadHostToolRegistry(root), projection.host),
        )
      }

      if (
        projection.transforms.includes('hooks-merge') &&
        options.mergeHooks !== false
      ) {
        const targetPath = path.join(root, entry.target)

        // A target-tracked hooks file belongs to the target repository. The
        // installer registers these hooks in the user-level Cursor file.
        if (gitTracksFile(targetPath)) {
          continue
        }

        const existing = fileExists(targetPath) ? readText(targetPath) : null

        content = mergeCursorHooksText(existing, content, entry.target)
      }

      rendered.push({
        id: projection.id,
        source: entry.source,
        target: entry.target,
        content,
      })
    }
  }

  return {
    rendered: rendered.sort((left, right) =>
      left.target.localeCompare(right.target),
    ),
    removals: removals.sort((left, right) =>
      left.target.localeCompare(right.target),
    ),
  }
}

/** Project canonical Pancreator Cursor artifacts into the local ignored .cursor tree. */
/**
 * Root-relative `.cursor` path of a persona's projected subagent. Resolved from
 * the projection manifest so the manifest stays the only place the namespaced
 * filename is declared.
 */
export function cursorAgentTarget(
  root: string,
  persona: string,
  suffix?: string,
): string {
  const agents = readProjectionManifest(root).projections.find(
    (projection) => projection.id === 'cursor-agents',
  )

  invariant(agents, 'projection manifest MUST declare cursor-agents', {
    code: 'INVALID_PROJECTION_MANIFEST',
  })

  return agents.target.replace(
    '{persona}',
    suffix ? `${persona}${VARIANT_SEPARATOR}${suffix}` : persona,
  )
}

/**
 * The agent name a projected Cursor agent path launches under: the file's
 * basename without its extension. Every surface that labels a delegation
 * derives it this way, so the label and the launch always agree.
 */
export function cursorAgentName(
  cursorAgentPath: string | null | undefined,
): string | null {
  if (typeof cursorAgentPath !== 'string' || cursorAgentPath.length === 0) {
    return null
  }

  return path.basename(cursorAgentPath, path.extname(cursorAgentPath))
}

/** Throws `INVALID_AGENT_SUFFIX` unless the variant suffix is lowercase alphanumerics joined by single hyphens. */
export function assertVariantSuffix(suffix: string): void {
  invariant(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(suffix),
    `Cursor agent variant suffix '${suffix}' MUST be lowercase alphanumeric ` +
      'with single hyphens.',
    { code: 'INVALID_AGENT_SUFFIX' },
  )
}

/**
 * Render run-scoped Cursor subagent variants for one suffix.
 *
 * A best-of-N session runs several candidates at once, each with its own model
 * per persona. Cursor reads the model from projected subagent frontmatter, so
 * the only way to route different models concurrently is a separate projected
 * file per candidate. Variants keep the `pan-` prefix, so the installer
 * collision rule still holds, and they are disposable like every other
 * `.cursor/` file.
 */
export function projectPersonaVariants(
  root: string,
  suffix: string,
  personas: Record<string, string>,
  options: { write?: boolean } = {},
): CursorProjectionChange[] {
  assertVariantSuffix(suffix)

  const mode = installationMode(root)
  const harnessPrefix = harnessPathPrefix(root)
  const resolveModel = createCursorModelResolver(root)
  const changes: CursorProjectionChange[] = []

  for (const [persona, model] of Object.entries(personas)) {
    // A stored best-of-N variant map is that candidate's execution contract, so
    // it is parsed verbatim. Canonicalizing here rewrote the stored spelling
    // into the agent file Cursor actually reads, which is the same defect as
    // rewriting a run snapshot on the way to an invocation card. No option
    // spelling is rejected, so nothing needs rewriting to stay loadable.
    const mapping = parsePersonaMapping(model, persona)

    // An external-executor persona has no Cursor subagent, so a variant would
    // record a model claim for work Cursor never performs.
    if (mapping.executor !== 'cursor') {
      continue
    }

    const source = `library/cursor/agents/${persona}.md`
    const absoluteSource = path.join(root, source)

    invariant(
      fileExists(absoluteSource),
      `Missing projection source: ${source}`,
      {
        code: 'INVALID_PROJECTION_MANIFEST',
      },
    )

    const target = cursorAgentTarget(root, persona, suffix)
    const template = readText(absoluteSource)

    invariant(
      template.includes('__PANCREATOR_MODEL__'),
      `${source} MUST contain __PANCREATOR_MODEL__.`,
      { code: 'INVALID_CURSOR_AGENT' },
    )

    const content = projectCursorContent(
      template.replaceAll(
        '__PANCREATOR_MODEL__',
        resolveModel(mapping, persona),
      ),
      target,
      mode,
      harnessPrefix,
    )
    const targetPath = path.join(root, target)
    const previous = fileExists(targetPath) ? readText(targetPath) : null
    const changed = previous !== content

    if (options.write && changed) {
      writeTextAtomic(targetPath, content)
    }

    changes.push({
      id: 'cursor-agent-variants',
      source,
      path: target,
      changed,
      previous_sha256: previous === null ? null : sha256(previous),
      sha256: sha256(content),
    })
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

/** Remove every run-scoped Cursor subagent variant carrying one suffix. */
export function removePersonaVariants(root: string, suffix: string): string[] {
  assertVariantSuffix(suffix)

  const directory = path.dirname(
    path.join(root, cursorAgentTarget(root, 'placeholder', suffix)),
  )

  if (!fileExists(directory)) {
    return []
  }

  const removed: string[] = []

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(`${VARIANT_SEPARATOR}${suffix}.md`)
    ) {
      continue
    }

    rmSync(path.join(directory, entry.name), { force: true })
    removed.push(entry.name)
  }

  return removed.sort()
}

/**
 * Renders every declared Cursor projection and compares it with the local
 * `.cursor/` tree, returning one change per rendered file plus each explicit
 * or orphaned removal, sorted by path. With `write`, it writes changed files
 * and deletes removed ones; otherwise it only reports.
 *
 * Orphan sweeping of Pancreator-owned agents, commands, and rules runs only
 * for a full render, never when `only` narrows it, and never touches
 * run-scoped variant files.
 */
export function syncCursorProjection(
  root: string,
  options: { write?: boolean } & RenderProjectionsOptions = {},
): CursorProjectionChange[] {
  const { rendered, removals } = renderProjections(root, options)
  const expected = new Set(rendered.map((entry) => entry.target))
  const explicitRemovals = new Set(removals.map((entry) => entry.target))

  // A narrowed render knows nothing about the projections it skipped, so
  // every projected file outside `only` would look orphaned. Sweeping there
  // would delete live agents and rules whenever one projection is synced
  // alone, which is how the drift advisory reads the tree.
  const sweepOrphans = options.only === undefined

  for (const relativeDirectory of sweepOrphans
    ? PANCREATOR_OWNED_DIRECTORIES
    : []) {
    const absoluteDirectory = projectionTargetPath(root, relativeDirectory)

    if (!fileExists(absoluteDirectory)) {
      continue
    }

    const skills = isSkillsDirectory(relativeDirectory)
    const orphans = readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          (skills ? entry.isDirectory() : entry.isFile()) &&
          isPancreatorOwnedCursorBasename(entry.name) &&
          !entry.name.includes(VARIANT_SEPARATOR),
      )
      .map((entry) => (skills ? `${entry.name}/SKILL.md` : entry.name))
      .filter((name) => {
        const target = `${relativeDirectory}/${name}`

        return !expected.has(target) && !explicitRemovals.has(target)
      })
    // A target repository may track its own `pan-*` file under a shared
    // host directory; only `.cursor/` reserves the namespace for Pancreator.
    const sweepable = relativeDirectory.startsWith('.cursor/')
      ? new Set(orphans)
      : sweepableCandidates(absoluteDirectory, orphans)

    for (const name of orphans) {
      const target = `${relativeDirectory}/${name}`

      if (!sweepable.has(name)) {
        continue
      }

      removals.push({
        id: 'orphaned-cursor-projection',
        source: 'canonical source absent',
        target,
      })
      explicitRemovals.add(target)
    }
  }

  const changes: CursorProjectionChange[] = rendered.map((entry) => {
    const targetPath = projectionTargetPath(root, entry.target)
    const previous = fileExists(targetPath) ? readText(targetPath) : null
    const changed = previous !== entry.content

    if (options.write && changed) {
      writeTextAtomic(targetPath, entry.content)
    }

    return {
      id: entry.id,
      source: entry.source,
      path: entry.target,
      changed,
      previous_sha256: previous === null ? null : sha256(previous),
      sha256: sha256(entry.content),
    }
  })

  for (const removal of removals) {
    const targetPath = projectionTargetPath(root, removal.target)
    const previous = fileExists(targetPath) ? readText(targetPath) : null

    if (previous === null) {
      continue
    }

    if (options.write) {
      rmSync(targetPath, { force: true })
      removeEmptySkillFolder(removal.target, targetPath)
    }

    changes.push({
      id: removal.id,
      source: removal.source,
      path: removal.target,
      changed: true,
      previous_sha256: sha256(previous),
      sha256: '',
      removed: true,
    })
  }

  if (options.write && changes.some((change) => change.removed)) {
    pruneEmptyHostDirectories(root)
  }

  return changes.sort((left, right) => left.path.localeCompare(right.path))
}

/**
 * Render declared Cursor projections in memory without reading or writing the
 * ignored local `.cursor` tree.
 */
export function renderCursorProjectionSources(
  root: string,
): CursorProjectionSource[] {
  return renderProjections(root, { mergeHooks: false }).rendered.map(
    (entry) => ({
      id: entry.id,
      source: entry.source,
      path: entry.target,
      content: entry.content,
    }),
  )
}

/** Validate canonical projection ownership and optional local projection drift. */
export function validateProjectionDrift(root: string): ProjectionDriftResult {
  const errors: string[] = []
  let regenerationCommand = `${panCommand(root)} models --sync`

  try {
    const manifest = readProjectionManifest(root)
    regenerationCommand = manifest.regeneration_command.replace(
      './bin/pan',
      panCommand(root),
    )

    if (installationMode(root) === 'self_development') {
      const cursorignorePath = path.join(root, '.cursorignore')
      const configuredWorktreeRoot =
        loadProjectConfig(root).worktrees?.root ?? 'worktrees/operator'
      const managedWorkspaceRoots = [
        configuredWorktreeRoot,
        'runtime/worktrees',
        '.claude/worktrees',
      ].map((entry) => entry.replace(/^\.\//u, '').replace(/\/$/u, ''))

      if (!fileExists(cursorignorePath)) {
        errors.push('missing required file: .cursorignore')
      } else {
        const rules = readText(cursorignorePath)
          .split(/\r?\n/u)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('#'))

        for (const rule of rules) {
          if (rule.startsWith('!')) {
            continue
          }

          // A rule reduces to the directory it excludes: an anchoring slash
          // or a leading `**/` adds nothing at the repository root, and a
          // trailing `/`, `/*`, or `/**` (in any run) excludes the tree just
          // as the bare name does. A wildcard inside a path segment is not
          // evaluated here, so such a rule is judged by review, not by this
          // check.
          let directory = rule.replace(/^\//u, '').replace(/^\*\*\//u, '')

          while (/\/(?:\*\*|\*)?$/u.test(directory)) {
            directory = directory.replace(/\/(?:\*\*|\*)?$/u, '')
          }

          const excluded = managedWorkspaceRoots.find(
            (workspace) =>
              workspace === directory || workspace.startsWith(`${directory}/`),
          )

          if (excluded) {
            errors.push(
              `.cursorignore rule '${rule}' excludes managed workspace root ` +
                `'${excluded}'; ignore nested instruction files instead`,
            )
          }
        }
      }

      const gitignorePath = path.join(root, '.gitignore')

      if (!fileExists(gitignorePath)) {
        errors.push('missing required file: .gitignore')
      } else {
        const lines = readText(gitignorePath)
          .split(/\r?\n/u)
          .map((line) => line.trim())
        const cursorNegations = lines.filter((line) =>
          line.startsWith('!.cursor/'),
        )

        if (!lines.includes('.cursor/')) {
          errors.push('.gitignore MUST ignore .cursor/ as a local projection')
        }

        if (cursorNegations.length > 0) {
          errors.push('.gitignore MUST NOT re-include files beneath .cursor/')
        }
      }
    }

    const targetModes = new Map<string, Set<string>>()

    for (const projection of manifest.projections) {
      const expanded = expandProjection(root, projection)

      if (expanded.length === 0) {
        errors.push(`projection ${projection.id} has no canonical source files`)
      }

      for (const entry of expanded) {
        if (!fileExists(path.join(root, entry.source))) {
          errors.push(`missing projection source: ${entry.source}`)
        }
      }

      // A shared target projects alongside every host, so it collides with a
      // host-bound projection of the same path.
      const modes = targetModes.get(projection.target) ?? new Set()
      const hostKeys =
        projection.host === 'shared' ? PROJECT_HOSTS : [projection.host]

      for (const mode of projection.installation_modes) {
        for (const host of hostKeys) {
          const key = `${mode}:${host}`

          if (modes.has(key)) {
            errors.push(
              `multiple projections target ${projection.target} in ${mode} mode for ${host}`,
            )
          }

          modes.add(key)
        }
      }

      targetModes.set(projection.target, modes)
    }

    if (
      fileExists(path.join(root, '.cursor')) ||
      enabledHosts(root).some((host) => host !== 'cursor')
    ) {
      const changes = syncCursorProjection(root)
      const hasManagedProjection = changes.some((change) =>
        fileExists(projectionTargetPath(root, change.path)),
      )

      if (hasManagedProjection) {
        for (const change of changes) {
          if (change.changed) {
            errors.push(
              `${change.path} projection drift; run ${regenerationCommand}`,
            )
          }
        }
      }
    }
  } catch (error) {
    errors.push(String(error))
  }

  return {
    errors: [...new Set(errors)],
    regeneration_command: regenerationCommand,
  }
}
