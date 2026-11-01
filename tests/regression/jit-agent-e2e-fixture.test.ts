import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/jit-agent-e2e')

interface Scenario {
  brief: string
  expectedReceipts: { policyId: string; trigger: string; route: string }[]
  forbiddenTriggers: string[]
}

const expectations = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, 'expectations.json'), 'utf8'),
) as Record<string, Scenario>

// The subagent receives only the brief. A brief that names the mechanism under
// test lets the agent steer the result, so the briefs must stay blind.
const BLIND_TERMS = [
  /polic/i,
  /receipt/i,
  /hook/i,
  /clause/i,
  /deferred/i,
  /trigger/i,
  /BROWSER-001/i,
  /expect/i,
  /governance card/i,
]

test('each E2E brief is blind to the policy-loading parameters', () => {
  for (const [name, scenario] of Object.entries(expectations)) {
    const brief = fs.readFileSync(
      path.join(FIXTURE_DIR, scenario.brief),
      'utf8',
    )
    const stripped = brief.replace(/`[^`]*`/g, '')

    for (const term of BLIND_TERMS) {
      assert.doesNotMatch(
        stripped,
        term,
        `${name} brief leaks ${term} outside a code span`,
      )
    }
  }
})

test('expectations name a trigger for every expected receipt', () => {
  for (const scenario of Object.values(expectations)) {
    for (const receipt of scenario.expectedReceipts) {
      assert.match(receipt.trigger, /^(tool|event|path):/)
      assert.ok(['hook', 'pull', 'inline'].includes(receipt.route))
      assert.ok(!scenario.forbiddenTriggers.includes(receipt.trigger))
    }
  }
})
