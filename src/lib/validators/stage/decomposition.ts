/** The decomposition Markdown artifact validator. */

import path from 'node:path'

import { readText } from '../../io.js'
import { parseMarkdown, hasHeading } from '../../markdown.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { issue } from './evidence.js'

/**
 * Validate a decomposition Markdown artifact: required sections, a decision of
 * exactly `retain` or `decompose`, threshold and economics coverage, and for
 * `retain` the retained intake spec with no chunks, or for `decompose` a
 * dependency graph, execution order, and at least two well-formed, sequential
 * chunks. Raises `decomposition.*` codes.
 */
export function validateDecompositionArtifact(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const content = readText(path.join(input.root, input.targetPath))
  const parsed = parseMarkdown(content)
  const lower = content.toLowerCase()

  const requiredHeadings = [
    'decision',
    'scope summary',
    'threshold assessment',
    'fragmentation economics',
    'requirement traceability',
    'risks and unknowns',
    'next action',
  ]

  for (const heading of requiredHeadings) {
    if (!hasHeading(parsed, heading)) {
      issues.push(
        issue(
          'decomposition.section_missing',
          `Decomposition MUST include heading: ${heading}`,
        ),
      )
    }
  }

  const decisionSection = /^## Decision\s*\n+([^\n]+)/imu.exec(content)?.[1]
  const normalizedDecision = decisionSection
    ?.replaceAll(/[`*_]/gu, '')
    .replace(/^decision\s*:\s*/iu, '')
    .trim()
    .toLowerCase()

  if (normalizedDecision !== 'retain' && normalizedDecision !== 'decompose') {
    issues.push(
      issue(
        'decomposition.decision',
        'Decision section MUST contain exactly retain or decompose',
      ),
    )
  }

  const thresholdTerms = [
    'independence gate',
    'hard trigger',
    'pressure indicator',
    'file count',
  ]

  for (const term of thresholdTerms) {
    if (!lower.includes(term)) {
      issues.push(
        issue(
          'decomposition.threshold_coverage',
          `Threshold assessment MUST address ${term}`,
        ),
      )
    }
  }

  if (!lower.includes('workflow overhead') || !lower.includes('risk')) {
    issues.push(
      issue(
        'decomposition.economics',
        'Fragmentation economics MUST compare workflow overhead with risk reduction',
      ),
    )
  }

  const chunkPattern = /^## Chunk (\d+):\s+(.+)$/gmu
  const chunkMatches = [...content.matchAll(chunkPattern)]

  if (normalizedDecision === 'retain') {
    if (!hasHeading(parsed, 'retained intake spec')) {
      issues.push(
        issue(
          'decomposition.retained_spec',
          'A retain decision MUST include the retained intake spec',
        ),
      )
    }

    if (chunkMatches.length > 0) {
      issues.push(
        issue(
          'decomposition.retain_chunks',
          'A retain decision MUST NOT include decomposed chunks',
        ),
      )
    }
  }

  if (normalizedDecision === 'decompose') {
    for (const heading of ['dependency graph', 'execution order']) {
      if (!hasHeading(parsed, heading)) {
        issues.push(
          issue(
            'decomposition.section_missing',
            `A decompose decision MUST include heading: ${heading}`,
          ),
        )
      }
    }

    if (chunkMatches.length < 2) {
      issues.push(
        issue(
          'decomposition.chunk_count',
          'A decompose decision MUST contain at least two chunks',
        ),
      )
    }

    if (
      chunkMatches.length > 5 &&
      !hasHeading(parsed, 'more than five chunks justification')
    ) {
      issues.push(
        issue(
          'decomposition.over_fragmented',
          'More than five chunks MUST include an explicit justification',
        ),
      )
    }

    const expectedNumbers = chunkMatches.map((_, index) => index + 1)
    const observedNumbers = chunkMatches.map((match) => Number(match[1]))

    if (
      observedNumbers.some((number, index) => number !== expectedNumbers[index])
    ) {
      issues.push(
        issue(
          'decomposition.chunk_sequence',
          'Chunk headings MUST be numbered sequentially from 1',
        ),
      )
    }

    const requiredChunkSections = [
      'objective',
      'in scope',
      'out of scope',
      'acceptance criteria',
      'dependencies',
      'validation',
      'handoff contract',
    ]

    for (const [index, match] of chunkMatches.entries()) {
      const start = match.index ?? 0
      const end = chunkMatches[index + 1]?.index ?? content.length
      const block = content.slice(start, end)
      const blockParsed = parseMarkdown(block)

      for (const heading of requiredChunkSections) {
        if (!hasHeading(blockParsed, heading)) {
          issues.push(
            issue(
              'decomposition.chunk_section_missing',
              `Chunk ${index + 1} MUST include heading: ${heading}`,
            ),
          )
        }
      }

      const acceptanceHeading = /^### Acceptance criteria\s*$/imu.exec(block)
      let acceptanceSection = ''

      if (acceptanceHeading?.index !== undefined) {
        const remainder = block.slice(
          acceptanceHeading.index + acceptanceHeading[0].length,
        )
        const nextHeading = /^###?\s+/mu.exec(remainder)
        acceptanceSection = remainder.slice(0, nextHeading?.index)
      }

      if (!acceptanceSection || !/^\s*\d+\.\s+\S/mu.test(acceptanceSection)) {
        issues.push(
          issue(
            'decomposition.chunk_acceptance',
            `Chunk ${index + 1} MUST include numbered acceptance criteria`,
          ),
        )
      }
    }

    if (!/\bDAG\b|directed acyclic graph/iu.test(content)) {
      issues.push(
        issue(
          'decomposition.dependency_graph',
          'Dependency graph MUST identify the chunk graph as a DAG',
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
