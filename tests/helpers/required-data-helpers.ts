import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Invocation, RunState } from '../../src/lib/types.js'
import { writePlanningFixtureSpecs } from './fixture-helpers.js'
import {
  gateEvidenceCitations,
  gitChangedFiles,
  prepareFixtureReleaseMetadata,
} from './output-helpers.js'

export function requiredData(
  stage: string,
  root?: string,
  invocation?: Invocation,
  runState?: RunState,
  workflowSlug?: string,
): Record<string, unknown> {
  if (workflowSlug === 'planning' && stage === 'plan' && root) {
    return {
      ...requiredData(stage, root, invocation, runState, 'delivery'),
      cohort_plan: writePlanningFixtureSpecs(root),
    }
  }

  if (workflowSlug === 'prototype') {
    switch (stage) {
      case 'intake':
        return {
          prototype_brief: {
            objective: 'Test whether one adapter covers both providers.',
            technical_questions: [
              {
                id: 'TQ-01',
                question: 'Does one adapter interface cover both providers?',
              },
            ],
            success_signals: [
              {
                question_id: 'TQ-01',
                signal: 'Both providers respond through the adapter.',
              },
            ],
            acceptable_shortcuts: ['Hard-coded credentials'],
            out_of_scope: ['Migration and hardening'],
          },
        }
      case 'approach':
        return {
          technical_approach: {
            hypothesis: 'One adapter interface is sufficient.',
            strategy: 'Add a thin adapter and route both providers through it.',
            touch_points: ['src/adapter.ts'],
            planned_shortcuts: ['Skip retry handling'],
            observable_signals: [
              { question_id: 'TQ-01', signal: 'Both providers respond.' },
            ],
            discard_conditions: [
              'Either provider needs caller-visible config.',
            ],
            preconditions: [
              {
                id: 'PRE-01',
                affected_questions: ['TQ-01'],
                check: 'Fixture dependency check',
                status: 'ready',
                evidence: ['fixture-ready'],
                volatile: false,
              },
            ],
          },
        }
      case 'build':
        return {
          spike: {
            changed_files: [],
            shortcuts_taken: [
              {
                shortcut: 'Skipped retry handling',
                reason: 'Not needed to answer the question.',
              },
            ],
            signal_evidence: [
              {
                signal: 'Both providers respond.',
                observed: 'Both returned a completion.',
              },
            ],
            notes: ['fixture spike'],
            precondition_checks: [
              {
                precondition_id: 'PRE-01',
                status: 'ready',
                evidence: ['fixture recheck'],
              },
            ],
          },
        }
      case 'evaluate':
        return {
          evaluation: {
            verdict: 'validated',
            question_results: [
              {
                question_id: 'TQ-01',
                result: 'answered',
                cause: 'product',
                evidence: ['fixture'],
                discard_condition_met: false,
              },
            ],
            environment_blockers: [],
            signal_assessment: [
              { signal: 'Both providers respond.', measures_question: true },
            ],
            productionization_gap: ['Restore retry handling'],
            recommendation: 'Productionize through a systematic dev run.',
            discard_candidates: ['hard-coded credentials'],
          },
        }
      default:
        throw new Error(`Unknown prototype stage ${stage}`)
    }
  }

  switch (stage) {
    case 'design':
      return {
        design_spec: {
          summary: 'A complete fixture design.',
          screens: ['Primary'],
          tokens: { color: '#000000' },
        },
        mocks: [
          {
            kind: 'html',
            screen: 'Primary',
            path: 'runtime/artifacts/mocks/primary.html',
          },
        ],
        acceptance_criteria: [
          { id: 'DAC-01', criterion: 'The primary screen is visible.' },
        ],
      }
    case 'intake':
      return {
        product_spec: {
          summary: 'A harness',
          user_stories: [{ id: 'US-01', statement: 'Run a workflow' }],
          constraints: ['C-1: No runtime dependencies'],
          out_of_scope: ['OOS-1: Remote services'],
          open_questions: [],
        },
      }
    case 'plan':
      return {
        product_spec: {
          summary: 'A harness',
          user_stories: [{ id: 'US-01', statement: 'Run a workflow' }],
          constraints: ['C-1: No runtime dependencies'],
          out_of_scope: ['OOS-1: Remote services'],
          open_questions: [],
        },
        engineering_plan: {
          approach: 'Use files and a state machine',
          components: ['engine'],
          files: [
            {
              path: 'src/base.ts',
              status: 'modified',
              purpose: 'Workflow engine',
            },
          ],
          risks: [],
          validation: ['tests'],
        },
        acceptance_criteria: [
          {
            id: 'AC-01',
            criterion: 'Workflow advances',
            maps_to: ['US-01'],
            verification: {
              method: 'integration test',
              expected: 'Workflow reaches ship',
            },
            proof: 'test',
          },
        ],
        test_plan: [
          {
            id: 'TP-01',
            acceptance_id: 'AC-01',
            steps: 'Run the workflow fixture end to end',
            expected: 'The run reaches ship',
          },
        ],
        open_question_dispositions: [],
      }
    case 'verify':
      return {
        verify: {
          verdict: 'pass',
          findings: [],
          qa_cases: [
            {
              id: 'TP-01',
              steps: 'Run workflow fixture',
              expected: 'advance',
              actual: 'advance',
              result: 'pass',
            },
          ],
          // VERIFY-001: QA cites the card's current gate evidence. QA does
          // not run the profile again.
          gate_evidence_citations: gateEvidenceCitations(invocation),
          acceptance_results: [
            { id: 'AC-01', result: 'pass', evidence: ['fixture'] },
          ],
          // A scoped return visit ran no evidence worker, so a compliant
          // verifier records each assigned dimension itself.
          ...(invocation?.scoped_return
            ? {
                dimensions: Object.fromEntries(
                  invocation.scoped_return.dimensions.map((dimension) => [
                    dimension.role,
                    {
                      summary: `Fixture ${dimension.role} dimension.`,
                      evidence: ['fixture'],
                    },
                  ]),
                ),
              }
            : {}),
        },
      }
    case 'remediate':
      return {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: ['fixture remediation'],
          remediation: [
            {
              cause: 'Verify recorded a blocking failure.',
              action: 'Address the recorded failure before resubmission.',
              evidence: ['fixture remediation evidence'],
            },
          ],
        },
        acceptance_results: [
          {
            id: 'AC-01',
            result: 'pass',
            evidence: ['The workflow fixture advances after remediation.'],
          },
        ],
      }
    case 'implement':
      return {
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: ['fixture'],
          ...(invocation && invocation.attempt > 1
            ? {
                remediation: [
                  {
                    cause: 'Prior stage attempt failed.',
                    action: 'Address the recorded failure before resubmission.',
                    evidence: ['fixture remediation evidence'],
                  },
                ],
              }
            : {}),
        },
        acceptance_results: [
          {
            id: 'AC-01',
            result: 'pass',
            evidence: ['tests/integration/delivery-workflow.test.ts'],
          },
        ],
      }
    case 'review':
      return {
        review: {
          verdict: 'pass',
          findings: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: ['fixture'],
            },
          ],
          maintenance_assessment: 'Proportionate',
        },
      }
    case 'test':
      return {
        test: {
          verdict: 'pass',
          cases: [
            {
              id: 'QA-1',
              steps: 'Run workflow fixture',
              expected: 'advance',
              actual: 'advance',
              result: 'pass',
            },
          ],
          defects: [],
          acceptance_results: [
            {
              id: 'AC-01',
              result: 'pass',
              evidence: ['fixture'],
            },
          ],
        },
      }
    case 'consolidate':
      return {
        consolidation: {
          candidates: [
            {
              run_id: 'fixture-candidate',
              verdict: 'adopted',
              strengths: ['Smallest change'],
              weaknesses: ['Thin tests'],
              taken: 'Its adapter boundary',
            },
          ],
          strategy: 'Adopt one candidate and add the missing tests.',
        },
        implementation: {
          changed_files: [],
          tests_added: [],
          notes: ['fixture'],
        },
        acceptance_criteria: [
          {
            id: 'AC-01',
            criterion: 'Workflow advances',
            maps_to: ['US-01'],
            verification: {
              method: 'integration test',
              expected: 'Workflow reaches ship',
            },
          },
        ],
        acceptance_results: [
          { id: 'AC-01', result: 'pass', evidence: ['fixture'] },
        ],
      }
    case 'inspect':
      return { inspection: { findings: [], verdict: 'pass' } }
    case 'ship': {
      const fingerprint =
        invocation?.workspace_before.fingerprint ?? 'fixture-fingerprint'
      const stageHistory = Array.isArray(runState?.stage_history)
        ? runState.stage_history
        : []
      const historyFingerprints = new Map<string, string>()

      for (const item of stageHistory) {
        historyFingerprints.set(item.stage, item.workspace_fingerprint)
      }

      const runWaivers = Array.isArray(runState?.operator_gate_waivers)
        ? runState.operator_gate_waivers
        : []
      const governanceIssues = Array.isArray(
        runState?.governance_artifact_issues,
      )
        ? runState.governance_artifact_issues
        : []
      const deferred = new Set<string>()

      for (const waiver of runWaivers) {
        for (const criterion of waiver.deferred_acceptance_criteria) {
          deferred.add(criterion)
        }
      }

      const projectConfig = root
        ? (JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8')) as {
            installation_mode?: string
          })
        : null
      const fixtureRelease =
        projectConfig?.installation_mode === 'self_development' && root
          ? prepareFixtureReleaseMetadata(root)
          : null
      const versioning = fixtureRelease
        ? {
            versioning: {
              current_version: fixtureRelease.currentVersion,
              recommendation: 'patch',
              proposed_version: fixtureRelease.proposedVersion,
              baseline_commit: fixtureRelease.baselineCommit,
              rationale:
                'Fixture release contains backward-compatible maintenance changes.',
              compatibility: 'Backward compatible.',
              updated_files: fixtureRelease.updatedFiles,
              release_index_action:
                'Create the release commit first, then add its hash in a separate index metadata commit.',
            },
          }
        : {}

      return {
        release: {
          summary: 'Ready',
          ...versioning,
          change_list: root
            ? gitChangedFiles(root).map((changedPath) => ({
                path: changedPath,
                kind: 'modified',
                description: 'Fixture workspace change.',
              }))
            : [],
          validation: historyFingerprints.has('verify')
            ? [
                {
                  stage: 'verify',
                  workspace_fingerprint:
                    historyFingerprints.get('verify') ?? fingerprint,
                  evidence_path: 'src/base.ts',
                },
              ]
            : [
                {
                  stage: 'review',
                  workspace_fingerprint:
                    historyFingerprints.get('review') ?? fingerprint,
                  evidence_path: 'src/base.ts',
                },
                {
                  stage: 'test',
                  workspace_fingerprint:
                    historyFingerprints.get('test') ?? fingerprint,
                  evidence_path: 'src/base.ts',
                },
              ],
          rollback: 'Revert changes',
          waivers: runWaivers.map((waiver) => ({
            waiver_id: waiver.waiver_id,
            workspace_fingerprint: waiver.workspace_fingerprint,
          })),
          follow_up_cases: [],
          governance_artifact_review: {
            issues_reviewed: governanceIssues.map((issue) => issue.issue_id),
            repairs: [],
            escalations: [],
            summary:
              governanceIssues.length > 0
                ? 'All recorded governance and artifact issues were reviewed.'
                : 'No unresolved governance or artifact issues.',
          },
          deferred_acceptance_criteria: [...deferred],
          commit_message: 'Build harness',
          pr_body: 'Prototype',
        },
      }
    }
    default:
      throw new Error(`Unknown stage ${stage}`)
  }
}
