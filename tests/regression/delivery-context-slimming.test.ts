import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const REPO_ROOT = process.cwd()

function repoText(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

const BRIEF_POINTER = "Follow the card's `output.operator_brief` contract."

const DELIVERY_AND_PLANNING_PROMPTS = [
  'library/workflows/delivery/prompts/implement.md',
  'library/workflows/delivery/prompts/plan.md',
  'library/workflows/delivery/prompts/remediate.md',
  'library/workflows/delivery/prompts/verify.md',
  'library/workflows/delivery/prompts/ship.md',
  'library/workflows/planning/prompts/plan.md',
]

test('brief, conformance, command, and bootstrap surfaces drop listed contradictions', () => {
  const writeStageOutput = repoText('library/skills/write-stage-output.md')
  const craftArtifact = repoText('library/skills/craft-operator-artifact.md')
  const agents = repoText('AGENTS.md')
  const selfDevRule = repoText(
    'library/cursor/rules/pancreator-self-development.mdc',
  )
  const embeddedRule = repoText('library/cursor/rules/pancreator-embedded.mdc')
  const start = repoText('library/cursor/commands/pan-start.md')
  const resume = repoText('library/cursor/commands/pan-resume.md')
  const orchestrator = repoText('library/personas/orchestrator.md')

  assert.doesNotMatch(writeStageOutput, /pan briefs render/u)
  assert.match(writeStageOutput, /output\.operator_brief/u)
  assert.doesNotMatch(craftArtifact, /maximum of 20 words in an instruction/u)
  assert.match(craftArtifact, /\/pan-conform/u)

  for (const promptPath of DELIVERY_AND_PLANNING_PROMPTS) {
    const text = repoText(promptPath)

    assert.ok(
      text.includes(BRIEF_POINTER),
      `${promptPath} MUST use the card-contract pointer`,
    )
    assert.doesNotMatch(
      text,
      /edit its declared source and reference the rendered HTML/u,
    )
  }

  assert.match(agents, /docs\/workflow-authoring\.md/u)
  assert.match(agents, /\/pan-conform/u)
  assert.doesNotMatch(agents, /validate:chat-markdown/u)
  assert.doesNotMatch(agents, /Durable operator artifacts MUST apply/u)
  assert.match(selfDevRule, /\/pan-conform/u)
  assert.match(embeddedRule, /\/pan-conform/u)

  assert.doesNotMatch(start, /Read .*orchestrator\.md/u)
  assert.doesNotMatch(resume, /Read .*orchestrator\.md/u)
  assert.ok(
    Buffer.byteLength(orchestrator, 'utf8') < 10 * 1024,
    `orchestrator.md is ${Buffer.byteLength(orchestrator, 'utf8')} bytes`,
  )
  assert.match(orchestrator, /cohort status/u)
  assert.match(orchestrator, /models --probe/u)
  assert.match(orchestrator, /--no-autostart/u)
  assert.match(orchestrator, /decision packet/u)
  const watchLines = orchestrator.match(
    /Arm the watch in the launch turn before any other action/gu,
  )

  assert.equal(
    watchLines?.length,
    2,
    'orchestrator.md MUST arm the watch in worker delivery and card delivery once each',
  )
})
