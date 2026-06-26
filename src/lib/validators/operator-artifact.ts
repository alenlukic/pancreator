import path from 'node:path'

import { fileExists, isRecord, readJson, readText } from '../io.js'
import { operatorLeadPresent, parseMarkdown } from '../markdown.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'

export type ArtifactProfile =
  | 'intake'
  | 'plan'
  | 'implementation'
  | 'review'
  | 'qa'
  | 'release'
  | 'investigation'
  | 'spotfix'
  | 'escalation'

const PROFILE_HEADINGS: Record<ArtifactProfile, string[]> = {
  intake: ['approach', 'user stories', 'constraints'],
  plan: ['approach', 'architecture', 'acceptance criteria'],
  implementation: ['summary', 'changes', 'acceptance'],
  review: ['findings', 'verdict'],
  qa: ['test cases', 'defects', 'verdict'],
  release: ['change list', 'rollback'],
  investigation: ['root cause', 'acceptance criteria', 'work mode'],
  spotfix: ['outcome', 'validation cycles'],
  escalation: ['escalation', 'acceptance criteria'],
}

export function validateOperatorArtifact(
  input: HandlerInput,
  profile: ArtifactProfile,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const absolute = path.isAbsolute(input.targetPath)
    ? input.targetPath
    : path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return {
      status: 'failed',
      issues: [
        {
          code: 'artifact.missing',
          message: `Artifact does not exist: ${input.targetPath}`,
        },
      ],
    }
  }

  const content = readText(absolute)

  if (!operatorLeadPresent(content)) {
    issues.push({
      code: 'operator.lead_missing',
      message:
        'Artifact MUST include operator-first state/outcome/next-action lead',
    })
  }

  const parsed = parseMarkdown(content)

  for (const heading of PROFILE_HEADINGS[profile]) {
    if (
      !parsed.headings.some((item) => item.text.toLowerCase().includes(heading))
    ) {
      issues.push({
        code: 'profile.heading_missing',
        message: `Profile '${profile}' requires heading containing '${heading}'`,
      })
    }
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}

export function validateStageOutputStrict(input: HandlerInput): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const absolute = path.join(input.root, input.targetPath)

  if (!fileExists(absolute)) {
    return {
      status: 'failed',
      issues: [
        { code: 'output.missing', message: 'Stage output file missing' },
      ],
    }
  }

  const value = readJson(absolute)

  if (!isRecord(value)) {
    return {
      status: 'invalid',
      issues: [
        { code: 'output.shape', message: 'Stage output MUST be an object' },
      ],
    }
  }

  if (value.result === 'success') {
    const criteria = Array.isArray(value.criteria) ? value.criteria : []

    for (const item of criteria) {
      if (
        isRecord(item) &&
        item.result === 'pass' &&
        (!Array.isArray(item.evidence) || item.evidence.length === 0)
      ) {
        issues.push({
          code: 'criteria.empty_evidence',
          message: `Criterion '${String(item.id)}' pass claim lacks evidence`,
          pointer: `/criteria/${String(item.id)}/evidence`,
        })
      }
    }
  }

  if (value.result === 'success' && Array.isArray(value.criteria)) {
    const failedHard = value.criteria.some(
      (item) => isRecord(item) && item.result === 'fail',
    )

    if (failedHard) {
      issues.push({
        code: 'result.contradiction',
        message: 'result success contradicts failed criterion self-evaluation',
      })
    }
  }

  return {
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  }
}
