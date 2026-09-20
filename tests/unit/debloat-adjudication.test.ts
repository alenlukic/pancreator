import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adjudicationAllowsSelection,
  assessCandidate,
  type AgenticAdjudication,
} from '../../src/lib/debloat/adjudication.js'
import type { Facility } from '../../src/lib/debloat/inventory.js'
import type { FacilityUsage } from '../../src/lib/debloat/usage.js'

const facility: Facility = {
  id: 'skill:widget',
  category: 'skill',
  name: 'widget',
  path: 'library/skills/widget.md',
  owned_paths: ['library/skills/widget.md'],
  selectable: true,
  node_kind: 'facility',
  protected: false,
}

function usage(tier: FacilityUsage['evidence_tier']): FacilityUsage {
  return {
    facility_id: facility.id,
    evidence_tier: tier,
    last_used_at: null,
    execution_count: 0,
    direction_count: 0,
    incidental_mention_count: 0,
    depended_on_by: [],
    test_only_references: false,
    samples: [],
  }
}

test('agentic adjudication settles only an unclear deterministic result', () => {
  const unclear = assessCandidate(facility, usage('none'))
  const removal: AgenticAdjudication = {
    facility_id: facility.id,
    verdict: 'remove',
    reasoning: 'No indirect consumer remains.',
    evidence: ['fixture'],
    recorded_at: '2026-09-20T00:00:00.000Z',
  }

  assert.equal(unclear.deterministic_verdict, 'unclear')
  assert.equal(adjudicationAllowsSelection(unclear, undefined), false)
  assert.equal(adjudicationAllowsSelection(unclear, removal), true)

  const retained = assessCandidate(facility, usage('reachable'))

  assert.equal(retained.deterministic_verdict, 'retained')
  assert.equal(
    adjudicationAllowsSelection(retained, removal),
    false,
    'an agentic verdict cannot clear deterministic retention',
  )
})
