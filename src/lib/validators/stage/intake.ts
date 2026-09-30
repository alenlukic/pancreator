/** The intake stage's product-specification validator. */

import path from 'node:path'

import { readJson, isRecord, fileExists, readText } from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { issue } from './evidence.js'
import { verificationRecommendationIssues } from './plan-trace.js'

/**
 * Validate an intake stage output's `data.product_spec`: a summary, user
 * stories with ids and statements, non-empty constraints, out-of-scope and
 * open-question arrays, a well-formed verification recommendation when present,
 * and artifacts that exist and cite at least one user story id. Raises
 * `intake.*` codes.
 */
export function validateIntakeOutput(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const value = readJson(path.join(input.root, input.targetPath)) as Record<
    string,
    unknown
  >
  const data = isRecord(value.data) ? value.data : {}
  const spec = isRecord(data.product_spec) ? data.product_spec : null

  issues.push(...verificationRecommendationIssues(data, 'intake'))

  if (!spec) {
    issues.push(issue('intake.spec_missing', 'data.product_spec is required'))
    return { status: 'failed', issues }
  }

  if (typeof spec.summary !== 'string' || spec.summary.trim().length === 0) {
    issues.push(
      issue('intake.summary', 'product_spec.summary MUST be non-empty'),
    )
  }

  const stories = Array.isArray(spec.user_stories) ? spec.user_stories : []
  const storyIds = new Set<string>()

  for (const [index, story] of stories.entries()) {
    if (!isRecord(story) || typeof story.id !== 'string') {
      issues.push(
        issue(
          'intake.story_id',
          `User story ${index + 1} MUST have a stable id`,
        ),
      )
      continue
    }

    storyIds.add(story.id)

    if (
      typeof story.statement !== 'string' ||
      story.statement.trim().length === 0
    ) {
      issues.push(
        issue(
          'intake.story_statement',
          `User story ${story.id} MUST have an observable statement`,
        ),
      )
    }
  }

  const constraints = Array.isArray(spec.constraints) ? spec.constraints : []

  if (constraints.length === 0) {
    issues.push(
      issue('intake.constraints', 'product_spec.constraints MUST be non-empty'),
    )
  }

  if (!Array.isArray(spec.out_of_scope)) {
    issues.push(
      issue(
        'intake.out_of_scope',
        'product_spec.out_of_scope MUST be an array',
      ),
    )
  }

  if (!Array.isArray(spec.open_questions)) {
    issues.push(
      issue(
        'intake.open_questions',
        'product_spec.open_questions MUST be an array',
      ),
    )
  }

  const artifacts = Array.isArray(value.artifacts) ? value.artifacts : []

  for (const artifact of artifacts) {
    if (!isRecord(artifact) || typeof artifact.path !== 'string') {
      continue
    }

    const artifactPath = path.join(input.root, artifact.path)

    if (!fileExists(artifactPath)) {
      issues.push(
        issue('intake.artifact_missing', `Artifact missing: ${artifact.path}`),
      )
      continue
    }

    const artifactContent = readText(artifactPath)
    let mentionedStories = 0

    for (const id of storyIds) {
      if (artifactContent.includes(id)) {
        mentionedStories += 1
      }
    }

    if (storyIds.size > 0 && mentionedStories === 0) {
      issues.push(
        issue(
          'intake.artifact_json_mismatch',
          `Artifact ${artifact.path} does not reference any user story ids from JSON`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
