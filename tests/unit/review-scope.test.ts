import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REVIEW_MACHINERY_PATTERNS,
  reviewMachineryConflicts,
} from '../../src/lib/review-scope.js'

test('a target that leaves the squad alone reviews independently', () => {
  const conflicts = reviewMachineryConflicts([
    'src/lib/engine.ts',
    'tests/unit/workflow.test.ts',
    'library/skills/spotfix.md',
    'governance/policies/VERIFY-001.json',
  ])

  assert.deepEqual(conflicts, [])
})

test('a change to the lineup or a charter is a self-review conflict', () => {
  const conflicts = reviewMachineryConflicts([
    'src/lib/engine.ts',
    'library/skills/review-squad.md',
    'library/skills/review-squad-pancreator.md',
  ])

  // The charters are what the dimension agents are told to look for, so a
  // defect introduced into one is a defect in the instrument doing the looking.
  assert.deepEqual(conflicts, [
    'library/skills/review-squad-pancreator.md',
    'library/skills/review-squad.md',
  ])
})

test('the coordinator, its policy, and both entry points are machinery', () => {
  const conflicts = reviewMachineryConflicts([
    'governance/policies/REVIEW-001.json',
    'governance/policies/SHEPHERD-001.json',
    'library/cursor/agents/shepherd-reviewer.md',
    'library/cursor/commands/pan-review.md',
    'library/cursor/commands/pan-shepherd.md',
    'library/personas/shepherd-reviewer.md',
    'library/skills/shepherd-pr.md',
  ])

  assert.equal(conflicts.length, 7)
})

test('a future lineup variant is covered without editing the pattern list', () => {
  // The lineup pattern is a prefix so that adding, say, a frontend lineup does
  // not silently fall outside the self-review check.
  const conflicts = reviewMachineryConflicts([
    'library/skills/review-squad-frontend.md',
  ])

  assert.deepEqual(conflicts, ['library/skills/review-squad-frontend.md'])
})

test('a near-miss path is not treated as machinery', () => {
  const conflicts = reviewMachineryConflicts([
    'library/skills/modern-code-review.md',
    'library/personas/reviewer.md',
    'library/cursor/agents/reviewer.md',
    'docs/review-notes.md',
  ])

  // The independent reviewer is the escape hatch for a conflict, so it must
  // not itself count as machinery — otherwise nothing could ever grade it.
  assert.deepEqual(conflicts, [])
})

test('conflicts are deduplicated and sorted', () => {
  const conflicts = reviewMachineryConflicts([
    'library/skills/review-squad.md',
    'library/skills/review-squad.md',
    'governance/policies/REVIEW-001.json',
  ])

  assert.deepEqual(conflicts, [
    'governance/policies/REVIEW-001.json',
    'library/skills/review-squad.md',
  ])
})

test('every declared pattern points at a real machinery surface', () => {
  for (const pattern of REVIEW_MACHINERY_PATTERNS) {
    assert.match(
      pattern,
      /^(?:governance|library|src)\//u,
      `${pattern} must be a repository-relative harness path`,
    )
  }
})
