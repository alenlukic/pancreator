/** Repository validation (`pan validate`) and its guidance checks. */

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '../errors.js'
import { fileExists, sha256, readText } from '../io.js'
import { validateEvalScenarios } from '../evals/scenario.js'
import {
  loadPipelineConfig,
  resolveConfigPersonas,
} from '../pipeline-config.js'
import {
  assertRepositoryChecksValid,
  repositoryCheckTemplateGaps,
} from '../repository-checks.js'
import type { LoadedPipelineConfig } from '../pipeline-config.js'
import { auditDirectives } from '../governance/audit-directives.js'
import { harnessRepairCategoryErrors } from '../governance/harness-repair-categories.js'
import { validateTurnReminderProfiles } from '../governance/prompt-context.js'
import { HANDLER_IDS, getHandler } from '../requirements/handlers.js'
import { auditTestScratchDirectories } from '../test-scratch-audit.js'
import { loadRegistry, validateRegistry } from '../requirements/registry.js'
import {
  validatePolicyRequirements,
  resolveRequirements,
} from '../requirements/resolve.js'
import { validateProjectionDrift } from '../projection.js'
import {
  loadPolicyCatalog,
  readPolicyLookupTable,
  resolvePolicies,
} from '../policies.js'
import { isSelfDevelopmentInstallation } from '../project-config.js'
import { validateCommandGovernance } from '../governance/command-coverage.js'
import { validateTargetAuthoring } from '../target-authoring.js'
import { targetRepoPrimerFreshness } from '../validators/target-repo-primer.js'
import {
  listWorkflowSlugs,
  loadWorkflow,
  stagePersonaCandidates,
} from '../workflow.js'
import {
  workflowSupportsDesignComposition,
  composeDesignWorkflow,
} from '../design-composition.js'
import {
  loadOperatorInvolvementFile,
  applyOperatorInvolvement,
} from '../operator-involvement.js'
import { validateReleaseMetadata } from '../versioning.js'
import type {
  RepositoryValidationResult,
  OperatorInvolvementFile,
  OperatorInvolvementProfile,
} from '../types.js'
import {
  DESIGN_PERSONAS,
  HANDBOOK_POLICY_REQUIREMENTS,
  handbookRequirementApplies,
  validateAwaitShellBan,
  validateGovernance,
  validateHarnessInstructionCoverage,
  validateLookupRowDelivery,
  validatePolicyAudienceDelivery,
  validatePolicyLookupCoverage,
  validatePolicyLookupDependencies,
  validateQuestionToolAccess,
  validateShellMonitor,
} from './governance.js'

export function validateRepository(root: string): RepositoryValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const selfDevelopment = isSelfDevelopmentInstallation(root)
  const required = [
    'AGENTS.md',
    'CHANGELOG.md',
    'VERSION',
    'package.json',
    'package-lock.json',
    'prettier.config.js',
    'tsconfig.json',
    'governance/registries/policy_lookup_table.json',
    'governance/handbooks/eng/engineering.md',
    'governance/handbooks/python/style-guide.md',
    'governance/handbooks/typescript/style-guide.md',
    'governance/registries/validation_registry.json',
    'governance/registries/directive_exemptions.json',
    'governance/registries/harness_repair_categories.json',
    'governance/registries/projection_manifest.json',
    'governance/registries/turn_reminder_profiles.json',
    'docs/validation-framework.md',
    'config.json',
    'library/schemas/config.schema.json',
    'library/schemas/stage-output.schema.json',
    'library/schemas/target-authoring.schema.json',
    'library/schemas/turn-reminder-profiles.schema.json',
    'library/schemas/workflow.schema.json',
    'library/schemas/stage.schema.json',
    'library/cursor/commands/pan-start.md',
    'library/cursor/commands/pan-resume.md',
    'library/cursor/commands/pan-repair.md',
    'library/cursor/commands/pan-decompose.md',
    'library/cursor/commands/pan-build-docs.md',
    'library/cursor/commands/pan-build-briefs.md',
    'library/cursor/commands/pan-spotfix.md',
    'library/cursor/commands/pan-pair.md',
    'library/cursor/commands/pan-write-pr.md',
    'library/cursor/agents/decomposer.md',
    'library/cursor/agents/librarian.md',
    'library/cursor/agents/harness-technician.md',
    'library/cursor/agents/spotfixer.md',
    'library/personas/decomposer.md',
    'library/personas/librarian.md',
    'library/personas/harness-technician.md',
    'library/personas/spotfixer.md',
    'library/skills/spotfix.md',
    'library/skills/write-pr-description.md',
    'library/skills/craft-operator-artifact.md',
    'library/operator-briefs/primitives.json',
    'library/operator-briefs/base.css',
    'library/schemas/operator-brief.schema.json',
    'library/schemas/operator-brief-system.schema.json',
    'library/templates/operator-briefs/project.json',
    'library/templates/operator-briefs/project.css',
    'library/templates/operator-briefs/brief.example.json',
    'docs/operator-brief-system.md',
    'library/templates/repository-checks.json',
    'library/templates/repository-checks.self-development.json',
    'library/templates/launchd-schedule.plist',
    'library/templates/spend-report.canvas.tsx',
    'release/index.json',
    'governance/policies/DECOMP-001.json',
    'governance/policies/PY-001.json',
    'governance/policies/BRIEF-001.json',
    'governance/policies/PRIMER-001.json',
    'governance/policies/REPO-001.json',
    'governance/policies/PR-001.json',
    'governance/policies/WORK-001.json',
    'governance/policies/REPAIR-001.json',
    'governance/policies/SPOT-001.json',
    'governance/policies/PAIR-001.json',
    'governance/policies/PROTO-001.json',
    'governance/policies/DIRECTOR-001.json',
    'library/workflows/prototype/workflow.json',
    'src/cli.ts',
    'target-extensions/.gitkeep',
  ]

  if (selfDevelopment) {
    required.push(
      'docs/operator-briefs/project.json',
      'docs/operator-briefs/project.css',
      // `bin/install` drops this file, so a target installation lacks it.
      'library/skills/review-squad-pancreator.md',
    )
  }

  for (const relative of required) {
    if (!fileExists(path.join(root, relative))) {
      errors.push(`missing required file: ${relative}`)
    }
  }

  const primerPath = path.join(root, 'docs', 'target-repo-primer.md')
  // `PRIMER-001` makes this file mandatory reading for every agent in every
  // installation, so its freshness is computed wherever it exists and rides
  // the shared validation result that `pan doctor` reports. Only the warning
  // is self-development-scoped, because a fresh embedded install owes zero.
  const primerFreshness = fileExists(primerPath)
    ? targetRepoPrimerFreshness(root)
    : null

  if (selfDevelopment && primerFreshness?.message) {
    warnings.push(primerFreshness.message)
  }

  errors.push(...validateQuestionToolAccess(root))
  errors.push(...validateAwaitShellBan(root))
  errors.push(...validateShellMonitor(root))
  errors.push(...validateEvalScenarios(root))
  errors.push(...harnessRepairCategoryErrors(root))
  errors.push(...validateReleaseMetadata(root).errors)

  try {
    assertRepositoryChecksValid(root)

    if (selfDevelopment) {
      warnings.push(...repositoryCheckTemplateGaps(root))
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  let pipelineConfig: LoadedPipelineConfig | null = null
  let handbookPolicies = new Map<string, Set<string>>()

  try {
    pipelineConfig = loadPipelineConfig(root)
  } catch (error) {
    errors.push(errorMessage(error))
  }

  try {
    const catalog = loadPolicyCatalog(root)

    if (catalog.size === 0) {
      errors.push('policy catalog MUST NOT be empty')
    }

    const lookup = readPolicyLookupTable(root)

    for (const row of lookup.rows) {
      for (const id of row.policies) {
        if (!catalog.has(id)) {
          errors.push(`policy lookup references missing policy: ${id}`)
        }
      }
    }

    validatePolicyLookupDependencies(catalog, lookup, errors)
    errors.push(...validatePolicyLookupCoverage(catalog, lookup))
    errors.push(...validateLookupRowDelivery(catalog, lookup))
    errors.push(...validatePolicyAudienceDelivery(catalog, lookup))

    if (
      fileExists(
        path.join(root, 'governance', 'registries', 'validation_registry.json'),
      )
    ) {
      const registry = loadRegistry(root)
      errors.push(...validateRegistry(registry, HANDLER_IDS))
      errors.push(...validatePolicyRequirements(catalog.values(), registry))

      const fieldContractEntry = registry.entries.get(
        'FIELD-CONTRACT-VALIDATE-001',
      )
      const fieldContractHandler = fieldContractEntry
        ? getHandler(fieldContractEntry.handler)
        : undefined

      if (fieldContractEntry && fieldContractHandler) {
        const fieldContract = fieldContractHandler({
          root,
          targetPath: 'library/schemas/stage-output-requirements.json',
          requirement: {
            policy_id: 'CONTRACT-001',
            requirement_id: 'stage-field-contract-validate',
            registry_id: fieldContractEntry.id,
            arguments: {},
          },
          catalog: registry,
        })

        errors.push(
          ...fieldContract.issues.map(
            (item) => `stage output field contract: ${item.message}`,
          ),
        )
      }

      for (const row of lookup.rows) {
        try {
          resolveRequirements(root, {
            persona: row.persona,
            workflow: row.workflow,
            stage: row.stage,
          })
        } catch (error) {
          errors.push(
            `requirement resolution failed for ${row.persona}/${row.workflow}/${row.stage}: ${errorMessage(error)}`,
          )
        }
      }
    }

    // Directive ownership and disposition evidence describe Pancreator source
    // authoring. Target installations omit that source evidence and validate
    // their generated guidance through its policy-bound validators instead.
    if (selfDevelopment) {
      const directiveAudit = auditDirectives(root)

      errors.push(...directiveAudit.errors)
      warnings.push(...directiveAudit.warnings)

      // The test suite is self-development only, so its scratch discipline is
      // checked here rather than in a target installation.
      errors.push(...auditTestScratchDirectories(root).errors)
    }

    const projection = validateProjectionDrift(root)
    errors.push(...projection.errors)
    errors.push(...validateTurnReminderProfiles(root))

    handbookPolicies = validateGovernance(root, catalog, errors)

    if (selfDevelopment) {
      errors.push(...validateHarnessInstructionCoverage(root, catalog))
    }
  } catch (error) {
    errors.push(errorMessage(error))
  }

  const workflowPersonas = new Set<string>()

  for (const slug of listWorkflowSlugs(root)) {
    try {
      const baseWorkflow = loadWorkflow(root, slug)
      const workflows = workflowSupportsDesignComposition(baseWorkflow)
        ? [baseWorkflow, composeDesignWorkflow(root, baseWorkflow)]
        : [baseWorkflow]
      const checkedStages = new Set<string>()
      const checkedPersonaContexts = new Set<string>()

      for (const workflow of workflows) {
        for (const stage of workflow.stages) {
          if (!checkedStages.has(stage.slug)) {
            checkedStages.add(stage.slug)

            // Repository verification MUST route through configured profiles rather
            // than baking a project-shaped command into a workflow (REPO-001).
            const canonicalRepositoryChecks: Record<
              string,
              Record<string, string>
            > = {
              dev: {
                'implement.lint': 'pan repository-check static',
                'implement.unit_tests': 'pan repository-check fast',
                'test.full_suite': 'pan repository-check full',
                'ship.validate': 'pan repository-check configuration',
              },
              prototype: {
                'build.static': 'pan repository-check static',
                'build.fast_checks': 'pan repository-check fast',
              },
            }
            const expectedForWorkflow = canonicalRepositoryChecks[workflow.slug]

            if (expectedForWorkflow) {
              for (const criterion of stage.criteria) {
                const expectedCommand = expectedForWorkflow[criterion.id]

                if (expectedCommand && criterion.command !== expectedCommand) {
                  errors.push(
                    `${workflow.slug} criterion '${criterion.id}' MUST use '${expectedCommand}'`,
                  )
                }

                if (criterion.id === 'test.coverage') {
                  errors.push(
                    `${workflow.slug} MUST NOT require a standalone coverage gate; configure coverage inside a target-owned repository profile when applicable`,
                  )
                }
              }
            }

            if (workflow.slug === 'prototype') {
              for (const criterion of stage.criteria) {
                if (
                  criterion.type === 'shell' &&
                  criterion.hard === true &&
                  criterion.command !== 'pan repository-check static'
                ) {
                  errors.push(
                    `prototype criterion '${criterion.id}' MUST NOT be a hard shell ` +
                      'gate other than the static profile; report other profiles as ' +
                      'advisory evidence instead',
                  )
                }
              }
            }
          }

          for (const persona of stagePersonaCandidates(stage)) {
            workflowPersonas.add(persona)
            const contextKey = `${workflow.slug}/${stage.slug}/${persona}`

            if (checkedPersonaContexts.has(contextKey)) {
              continue
            }
            checkedPersonaContexts.add(contextKey)

            const policies = resolvePolicies(root, {
              persona,
              workflow: workflow.slug,
              stage: stage.slug,
            })
            const policyIds = new Set(policies.map((policy) => policy.id))

            if (DESIGN_PERSONAS.has(persona)) {
              for (const required of ['DESIGN-001', 'BROWSER-001']) {
                if (!policyIds.has(required)) {
                  errors.push(
                    `workflow stage '${workflow.slug}/${stage.slug}' design persona '${persona}' MUST load ${required}`,
                  )
                }
              }
            }

            for (const requirement of HANDBOOK_POLICY_REQUIREMENTS) {
              if (
                !handbookRequirementApplies(requirement, selfDevelopment) ||
                !requirement.personas.has(persona)
              ) {
                continue
              }

              const handbookPolicyIds =
                handbookPolicies.get(requirement.handbook_path) ??
                new Set<string>()
              const applicablePolicies = requirement.technology
                ? resolvePolicies(root, {
                    persona,
                    workflow: workflow.slug,
                    stage: stage.slug,
                    technologies: [requirement.technology],
                  })
                : policies
              const hasHandbookPolicy = applicablePolicies.some((policy) =>
                handbookPolicyIds.has(policy.id),
              )

              if (!hasHandbookPolicy) {
                errors.push(
                  `workflow stage '${workflow.slug}/${stage.slug}' persona ` +
                    `'${persona}' MUST load a policy for the ${requirement.label}`,
                )
              }
            }

            const personaPath = path.join(
              root,
              'library',
              'personas',
              `${persona}.md`,
            )

            if (!fileExists(personaPath)) {
              errors.push(`missing persona: library/personas/${persona}.md`)
            }

            const agentPath = path.join(
              root,
              'library',
              'cursor',
              'agents',
              `${persona}.md`,
            )

            if (!fileExists(agentPath)) {
              errors.push(
                `missing Cursor agent template: library/cursor/agents/${persona}.md`,
              )
            }
          }
        }
      }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }

  validateOperatorInvolvementProfiles(root, errors)

  const cursorAgentPersonas = new Set<string>()
  const cursorAgentDirectory = path.join(root, 'library', 'cursor', 'agents')

  if (fileExists(cursorAgentDirectory)) {
    for (const entry of readdirSync(cursorAgentDirectory, {
      withFileTypes: true,
    })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) {
        continue
      }

      const persona = entry.name.slice(0, -3)
      cursorAgentPersonas.add(persona)

      if (
        !fileExists(path.join(root, 'library', 'personas', `${persona}.md`))
      ) {
        errors.push(`missing persona: library/personas/${persona}.md`)
      }
    }
  }

  const configuredPersonas = new Set([
    ...workflowPersonas,
    ...cursorAgentPersonas,
  ])

  if (pipelineConfig) {
    for (const configName of Object.keys(pipelineConfig.file.configs)) {
      const personas = resolveConfigPersonas(pipelineConfig.file, configName)

      for (const persona of configuredPersonas) {
        if (!personas[persona]) {
          errors.push(
            `pipeline config '${configName}' does not map persona '${persona}'`,
          )
        }
      }
    }
  }

  for (const directory of [
    'library/cursor/agents',
    'library/cursor/commands',
    'src/lib',
  ]) {
    const absolute = path.join(root, directory)

    if (fileExists(absolute) && readdirSync(absolute).length === 0) {
      warnings.push(`${directory} is empty`)
    }
  }

  // An installation carries `src/` but no test suite, so a missing `tests/`
  // is the expected shape rather than a defect.
  const legacyModules = ['src', 'tests']
    .map((directory) => path.join(root, directory))
    .filter((absolute) => fileExists(absolute))
    .flatMap((absolute) =>
      readdirSync(absolute, { encoding: 'utf8', recursive: true }),
    )
    .filter((entry) => entry.endsWith('.mjs'))

  if (legacyModules.length > 0) {
    errors.push('src/ and tests/ MUST NOT contain legacy .mjs modules')
  }

  validateAdHocModelInheritanceGuidance(root, errors)

  // The supervisor delegation paragraph is authored here and projected into
  // an installation, so the source checkout is the only place a drift
  // between the two rule files is a defect someone can fix.
  if (selfDevelopment) {
    validateSupervisorDelegationGuidance(root, errors)
  }

  validateCommandGovernance(root, errors, warnings)

  const targetExtensionRoot = path.join(root, 'target-extensions')
  const hasTargetExtensions =
    fileExists(targetExtensionRoot) &&
    readdirSync(targetExtensionRoot, { withFileTypes: true }).some((entry) =>
      entry.isDirectory(),
    )

  if (hasTargetExtensions) {
    errors.push(...validateTargetAuthoring(root).errors)
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...(primerFreshness ? { target_repo_primer: primerFreshness } : {}),
    // The hash identifies the validation verdict. Primer freshness is an
    // advisory reading of a generated file and is deliberately outside it.
    report_hash: sha256({ errors, warnings }),
  }
}

/**
 * Check every involvement profile against every workflow at authoring time. A
 * profile is shared across workflows, so a stage key only has to match one of
 * them; a key matching none is a typo that would otherwise surface as a failed
 * `pan init` for whoever selected the profile first.
 */
function validateOperatorInvolvementProfiles(
  root: string,
  errors: string[],
): void {
  let file: OperatorInvolvementFile

  try {
    file = loadOperatorInvolvementFile(root)
  } catch (error) {
    errors.push(errorMessage(error))
    return
  }

  const workflows = listWorkflowSlugs(root).flatMap((slug) => {
    try {
      return [loadWorkflow(root, slug)]
    } catch {
      // Workflow-level defects are already reported by the workflow loop.
      return []
    }
  })

  const profileEntries: Array<[string, OperatorInvolvementProfile]> =
    Object.entries(file.profiles)

  for (const [name, profile] of profileEntries) {
    for (const stageKey of Object.keys(profile.gates ?? {})) {
      if (stageKey === '*') {
        continue
      }

      const owners = workflows.filter((workflow) =>
        workflow.stages.some((stage) => stage.slug === stageKey),
      )

      if (owners.length === 0) {
        errors.push(
          `operator-involvement profile '${name}' targets stage '${stageKey}', ` +
            'which no workflow defines',
        )
      }
    }

    for (const workflow of workflows) {
      try {
        applyOperatorInvolvement(structuredClone(workflow), { name, profile })
      } catch (error) {
        // Only report the mismatch when the profile actually names a stage of
        // this workflow; a shared profile is allowed to be inert elsewhere.
        const targetsWorkflow = Object.keys(profile.gates ?? {}).some(
          (key) =>
            key === '*' || workflow.stages.some((stage) => stage.slug === key),
        )

        if (targetsWorkflow || (profile.contracts ?? []).length > 0) {
          errors.push(
            `operator-involvement profile '${name}' cannot apply to workflow ` +
              `'${workflow.slug}': ${errorMessage(error)}`,
          )
        }
      }
    }
  }
}

function validateAdHocModelInheritanceGuidance(
  root: string,
  errors: string[],
): void {
  const sources = [
    'AGENTS.md',
    'library/templates/embedded-AGENTS.md',
    'library/cursor/rules/pancreator-self-development.mdc',
    'library/cursor/rules/pancreator-embedded.mdc',
  ]

  for (const relative of sources) {
    const absolute = path.join(root, relative)

    if (!fileExists(absolute)) {
      continue
    }

    const content = readText(absolute)
    const hasDefaultInheritance =
      /Ad-hoc Subagent calls MUST omit `model`/u.test(content) &&
      /inherit the parent model/u.test(content)
    const hasExplicitOverride =
      /operator explicitly selects(?: a model| one| model)?/u.test(content)
    const hasNamedRouting =
      /named[- ]personas?/iu.test(content) &&
      (/projected/u.test(content) || /project\.json/u.test(content))

    if (!hasDefaultInheritance) {
      errors.push(
        `${relative} MUST require ad-hoc Subagent calls to omit model and inherit the parent model`,
      )
    }

    if (!hasExplicitOverride) {
      errors.push(
        `${relative} MUST preserve explicit operator-selected model override for ad-hoc Subagent calls`,
      )
    }

    if (!hasNamedRouting) {
      errors.push(
        `${relative} MUST preserve named-persona projected model routing`,
      )
    }
  }
}

/**
 * Records the supervisor delegation contract both always-applied rules carry.
 *
 * A nested supervisor silently runs every worker it launches on the platform
 * default model, so the refusal is the only thing standing between an
 * injected delegation and a run whose model routing is wrong everywhere. The
 * two rule files reach different audiences and must state it identically.
 */
export function validateSupervisorDelegationGuidance(
  root: string,
  errors: string[],
): void {
  const sources = [
    'library/cursor/rules/pancreator-self-development.mdc',
    'library/cursor/rules/pancreator-embedded.mdc',
  ]
  const paragraphs: Array<{ path: string; content: string }> = []

  for (const relative of sources) {
    const absolute = path.join(root, relative)

    if (!fileExists(absolute)) {
      continue
    }

    const paragraph = readText(absolute)
      .split(/\n\s*\n/u)
      .find((candidate) =>
        /A workflow supervisor MUST run in the operator's own session/u.test(
          candidate,
        ),
      )

    if (!paragraph) {
      errors.push(`${relative} MUST state where the workflow supervisor runs`)
      continue
    }

    if (!/you MUST refuse before calling the subagent/u.test(paragraph)) {
      errors.push(
        `${relative} MUST require refusal of injected supervisor delegation`,
      )
    }

    paragraphs.push({ path: relative, content: paragraph.trim() })
  }

  if (
    paragraphs.length === sources.length &&
    paragraphs.some((entry) => entry.content !== paragraphs[0]?.content)
  ) {
    errors.push(
      `${paragraphs.map((entry) => entry.path).join(' and ')} MUST share one supervisor delegation paragraph`,
    )
  }
}
