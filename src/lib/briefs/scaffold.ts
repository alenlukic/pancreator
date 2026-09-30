/**
 * Worker-facing brief support: the accepted card and section vocabulary for
 * the invocation card, and the operator-brief source scaffold written before
 * delegation.
 */

import { fileExists, resolveInside, writeJsonAtomic } from '../io.js'
import { OPERATOR_ARTIFACT_PROFILE_HEADINGS } from '../operator-artifact-profiles.js'
import { readRegistries } from './registry.js'
import type { BriefSection } from './types.js'

export interface BriefScaffoldOptions {
  source_path: string
  profile: string
  title: string
  source: string
}

export interface BriefVocabulary {
  card_types: string[]
  section_semantics: string[]
}

/**
 * The card types and section semantics the renderer will accept, merged from the
 * shared and project registries.
 *
 * The brief schema types both fields as open strings while the renderer enforces
 * a closed registry, and workers are told not to run the renderer — so a
 * schema-valid brief could still fail to render, with the failure only
 * discoverable after submission. Putting the real vocabulary on the invocation
 * card is what closes that gap.
 */
export function resolveBriefVocabulary(root: string): BriefVocabulary {
  const registries = readRegistries(root)

  return {
    card_types: Object.keys({
      ...registries.common.card_types,
      ...registries.project.card_types,
    }).sort(),
    section_semantics: Object.keys({
      ...registries.common.section_semantics,
      ...registries.project.section_semantics,
    }).sort(),
  }
}

const PROFILE_SECTION_SEMANTICS: Record<string, string[]> = {
  intake: ['context', 'actions', 'risks'],
  plan: ['workflow', 'changes', 'validation'],
  implementation: ['changes', 'validation', 'actions'],
  review: ['evidence', 'validation'],
  qa: ['validation', 'risks', 'actions'],
  release: ['release', 'validation'],
  inspection: ['evidence', 'validation'],
  'prototype-brief': ['context', 'actions', 'risks'],
  'prototype-approach': ['workflow', 'changes', 'risks'],
  spike: ['changes', 'risks', 'evidence'],
  'prototype-evaluation': ['evidence', 'validation', 'actions'],
}

/**
 * Create the operator-brief source at the exact indexed path before delegation.
 * Workers edit this file in place; they never need to discover a brief location
 * or invoke the renderer themselves.
 */
export function scaffoldOperatorBrief(
  root: string,
  options: BriefScaffoldOptions,
): void {
  const absolute = resolveInside(root, options.source_path)

  if (fileExists(absolute)) {
    return
  }

  const requiredHeadings = OPERATOR_ARTIFACT_PROFILE_HEADINGS[
    options.profile as keyof typeof OPERATOR_ARTIFACT_PROFILE_HEADINGS
  ] ?? ['details']
  const semantics = PROFILE_SECTION_SEMANTICS[options.profile] ?? [
    'context',
    'actions',
  ]
  const sections: BriefSection[] = [
    {
      semantic: 'executive-summary',
      title: 'Executive summary',
      cards: [
        {
          type: 'summary',
          title: 'Bottom line',
          body: 'Replace this scaffold with the concise operator-facing outcome, why it matters, and immediate next action.',
        },
      ],
    },
    ...requiredHeadings.map((heading, index) => {
      const semantic = semantics[index % semantics.length] ?? 'context'

      return {
        semantic,
        title: heading
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' '),
        cards: [
          {
            type:
              semantic === 'validation'
                ? 'validation'
                : semantic === 'risks'
                  ? 'risk'
                  : semantic === 'release'
                    ? 'release'
                    : semantic === 'actions'
                      ? 'action'
                      : 'summary',
            title: 'Complete this section',
            body: 'Replace this placeholder with stage-specific operator-facing content.',
          },
        ],
      }
    }),
  ]

  writeJsonAtomic(absolute, {
    schema_version: 1,
    brief_type: options.profile === 'release' ? 'release' : 'workflow-run',
    title: options.title,
    source: options.source,
    sections,
  })
}
