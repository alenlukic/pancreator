import assert from 'node:assert/strict'
import test from 'node:test'

import {
  intentFeatures,
  isInformationRequest,
  loadIntentClassifier,
  loadIntentCorpus,
  trainIntentClassifier,
  type IntentExample,
} from '../../src/lib/debloat/intent.js'

const REPO_ROOT = process.cwd()

test('the shipped corpus loads, labels every line, and trains a classifier that separates direction from mention', () => {
  const corpus = loadIntentCorpus(REPO_ROOT)

  assert.ok(corpus.length >= 4000, `corpus holds ${corpus.length} examples`)
  assert.ok(
    corpus.every(
      (entry) =>
        entry.text.trim().length > 0 &&
        (entry.label === 'functional' || entry.label === 'incidental'),
    ),
  )

  const classifier = loadIntentClassifier(REPO_ROOT)

  // A direction to invoke, run, read, or apply a facility is functional.
  for (const text of [
    'Run `./bin/pan validate` and confirm zero new errors.',
    '3. Read `library/skills/review-squad.md` from `## Principle` to the end.',
    'Apply `STE-001` to the prose: lead with outcome, consequence, and next action.',
    'Invoke the `pan-debloater` subagent and paste the complete card into its prompt.',
    '/pan-start --worktree fix-thing --request runtime/inbox/queue/request.md',
    '- You MUST iterate with `./bin/pan tests impacted` plus the tests you added.',
  ]) {
    assert.equal(classifier.classify(text).functional, true, text)
  }

  // A question, an index entry, a status paste, and an edit request are not.
  for (const text of [
    'what does /pan-start do?',
    '- `library/skills/review-squad.md`',
    '| `TEST-001` | `governance/handbooks/eng/testing.md` | `sha256:54a859b15a4c3df940ae761ee43a5630ab56f8b243dea98ba27a1f4998408d8d` |',
    '**COMMS-001 · Operator-facing chat output**',
    'Agent: pan-coder',
    '- `runtime/logs/workflows/63309_run/agent/evidence/97_implement-2-implement.lint.log` — `clean pass` `static` repository-check gate evidence at workspace fingerprint `080209f8` — the current workspace',
    '11. Remove the `## Chat reports` section from `governance/handbooks/writing/simplified-technical-english.md`.',
  ]) {
    assert.equal(classifier.classify(text).functional, false, text)
  }
})

test('the shipped corpus holds up under a deterministic hold-out split', () => {
  const corpus = loadIntentCorpus(REPO_ROOT)
  const train: IntentExample[] = []
  const held: IntentExample[] = []

  corpus.forEach((entry, index) => {
    ;(index % 5 === 0 ? held : train).push(entry)
  })

  const classifier = trainIntentClassifier(train)
  let correct = 0

  for (const entry of held) {
    if (
      classifier.classify(entry.text).functional ===
      (entry.label === 'functional')
    ) {
      correct += 1
    }
  }

  const accuracy = correct / held.length

  // The corpus was labeled by hand and the model is a linear one, so the
  // floor sits below the measured 0.94 and above the point where a mention
  // would routinely pass as usage.
  assert.ok(accuracy >= 0.88, `hold-out accuracy ${accuracy.toFixed(3)}`)
})

test('training is deterministic and features collapse facility names', () => {
  const examples: IntentExample[] = [
    { text: 'Run `pan validate` now.', label: 'functional' },
    { text: 'Read `library/skills/a.md` first.', label: 'functional' },
    { text: 'what is pan validate?', label: 'incidental' },
    { text: '- `library/skills/a.md`', label: 'incidental' },
  ]
  const first = trainIntentClassifier(examples)
  const second = trainIntentClassifier(examples)

  assert.equal(
    first.classify('Run `pan validate` now.').margin,
    second.classify('Run `pan validate` now.').margin,
  )

  const features = intentFeatures('Apply `REVIEW-001` and launch pan-reviewer.')

  assert.ok(features.includes('w=<policy>'))
  assert.ok(features.includes('w=<pan-name>'))
  assert.ok(features.includes('first=apply'))
  assert.ok(intentFeatures('/pan-start go').includes('^slash'))
  assert.ok(intentFeatures('| a | b |').includes('^table'))
})

test('an information request is a question or an explanatory opener, never a slash command', () => {
  assert.equal(isInformationRequest('what does /pan-start do?'), true)
  assert.equal(
    isInformationRequest('summarize how the debloat scan builds the graph'),
    true,
  )
  assert.equal(isInformationRequest('Explain the cascade rule.'), true)
  assert.equal(isInformationRequest('/pan-start fix the archive defect'), false)
  assert.equal(
    isInformationRequest('fix the flaky test in watch.test.ts'),
    false,
  )
  assert.equal(
    isInformationRequest('\n\nRun the release flow on this worktree.'),
    false,
  )
})
