import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { PanError } from '../../src/lib/errors.js'
import {
  CORE_SQUAD_SKILL_PATH,
  HARNESS_SQUAD_SKILL_PATH,
  REVIEW_DIMENSIONS,
  availableReviewDimensions,
  defaultReviewLineup,
  resolveReviewDimensionSelection,
  reviewDimensionSlug,
} from '../../src/lib/review-dimensions.js'
import { createFixture, sharedFixture } from '../helpers.js'

/** Level-three headings under `## Charters` in a squad skill file. */
function charterHeadings(root: string, relative: string): string[] {
  const lines = readFileSync(path.join(root, relative), 'utf8').split('\n')
  const start = lines.indexOf('## Charters')

  assert.notEqual(start, -1, `${relative} carries no ## Charters section`)

  const headings: string[] = []

  for (const line of lines.slice(start + 1)) {
    if (/^## /u.test(line)) {
      break
    }

    const match = /^### (.+)$/u.exec(line)

    if (match) {
      headings.push(match[1].trim())
    }
  }

  return headings
}

test('the slug table mirrors every charter the squad skills define', () => {
  const root = sharedFixture()

  for (const skillPath of [CORE_SQUAD_SKILL_PATH, HARNESS_SQUAD_SKILL_PATH]) {
    const fromSkill = charterHeadings(root, skillPath).map((heading) => ({
      heading,
      slug: reviewDimensionSlug(heading),
    }))
    const fromTable = REVIEW_DIMENSIONS.filter(
      (dimension) => dimension.charter_path === skillPath,
    ).map((dimension) => ({
      heading: dimension.charter_heading,
      slug: dimension.slug,
    }))

    // The skill stays canonical for the charters. This table only names them,
    // so a charter added or renamed in the skill must land here too.
    assert.deepEqual(
      fromTable,
      fromSkill,
      `${skillPath} drifted from the table`,
    )
  }
})

test('an empty selection runs the full default lineup', () => {
  const root = sharedFixture()
  const selection = resolveReviewDimensionSelection(root, [])

  assert.equal(selection.default, true)
  assert.deepEqual(selection.not_run, [])
  assert.deepEqual(
    selection.selected,
    defaultReviewLineup(root).map((dimension) => dimension.slug),
  )
  // A self-development checkout ships the harness lineup, which the skill
  // swaps in for a Pancreator target.
  assert.deepEqual(selection.selected, [
    'correctness-consistency',
    'agentic-practice',
    'performance',
  ])
  assert.deepEqual(
    selection.available,
    REVIEW_DIMENSIONS.map((dimension) => dimension.slug),
  )
})

test('a valid subset keeps canonical order and names what it leaves out', () => {
  const root = sharedFixture()
  const selection = resolveReviewDimensionSelection(root, [
    'performance',
    'security',
    'correctness-consistency',
  ])

  assert.equal(selection.default, false)
  assert.deepEqual(selection.selected, [
    'security',
    'correctness-consistency',
    'performance',
  ])
  assert.deepEqual(selection.not_run, ['agentic-practice'])
})

test('duplicates and surrounding whitespace collapse', () => {
  const root = sharedFixture()
  const selection = resolveReviewDimensionSelection(root, [
    ' security ',
    'security',
    '',
    'security',
  ])

  assert.deepEqual(selection.selected, ['security'])
  assert.equal(selection.default, false)
})

test('an unknown dimension is refused with the accepted list', () => {
  const root = sharedFixture()

  assert.throws(
    () =>
      resolveReviewDimensionSelection(root, ['security', 'maintainability']),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'UNKNOWN_REVIEW_DIMENSION' &&
      /Unknown review dimension: maintainability\./u.test(error.message) &&
      /Accepted dimensions: correctness, security, architecture, simplification, operations, frontend, correctness-consistency, agentic-practice, performance\./u.test(
        error.message,
      ),
  )
  assert.throws(
    () => resolveReviewDimensionSelection(root, ['speed', 'style']),
    (error: unknown) =>
      error instanceof PanError &&
      /Unknown review dimensions: speed, style\./u.test(error.message),
  )
})

test('a target installation accepts only the core lineup', () => {
  const root = createFixture()

  // bin/install drops the harness lineup from the staged payload.
  rmSync(path.join(root, HARNESS_SQUAD_SKILL_PATH))

  assert.deepEqual(
    availableReviewDimensions(root).map((dimension) => dimension.slug),
    [
      'correctness',
      'security',
      'architecture',
      'simplification',
      'operations',
      'frontend',
    ],
  )
  assert.deepEqual(
    defaultReviewLineup(root).map((dimension) => dimension.slug),
    availableReviewDimensions(root).map((dimension) => dimension.slug),
  )

  const selection = resolveReviewDimensionSelection(root, ['operations'])

  assert.deepEqual(selection.selected, ['operations'])
  assert.deepEqual(selection.not_run, [
    'correctness',
    'security',
    'architecture',
    'simplification',
    'frontend',
  ])
  assert.throws(
    () => resolveReviewDimensionSelection(root, ['performance']),
    (error: unknown) =>
      error instanceof PanError &&
      error.code === 'UNKNOWN_REVIEW_DIMENSION' &&
      !/correctness-consistency/u.test(error.message),
  )
})
