import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  analyzeSimplifiedEnglish,
  countSteWords,
  extractHtmlProse,
  extractMarkdownProse,
  splitSentences,
  validateSimplifiedEnglish,
} from '../../src/lib/validators/simplified-english.js'
import { createTestTempDirectory } from '../temp.js'

function input(root: string, targetPath: string) {
  return {
    root,
    targetPath,
    requirement: {
      policy_id: 'STE-001',
      requirement_id: 'simplified-english-validate',
      registry_id: 'SIMPLIFIED-ENGLISH-VALIDATE-001',
      arguments: {},
    },
  }
}

function scratchRoot(): string {
  return createTestTempDirectory('pan-ste-')
}

function codes(markdown: string): string[] {
  return analyzeSimplifiedEnglish(extractMarkdownProse(markdown)).map(
    (issue) => issue.code,
  )
}

function writeArtifact(
  root: string,
  relative: string,
  content: string,
): string {
  const absolute = path.join(root, relative)
  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, content)
  return relative
}

test('word count treats an inline code span as one word (STE 8.6)', () => {
  const cases: Array<[string, number, string]> = [
    ['Run `./bin/pan validate` to check the state.', 6, 'inline code span'],
    ['The gate for policy STE-001 failed.', 6, 'identifier'],
    ['Read governance/policies/STE-001.json now.', 3, 'path'],
    ['Pass --involvement to the command.', 5, 'flag'],
    ['The main-gear-door handle moved.', 4, 'hyphenated word'],
    ['The stage closed (the operator approved it) today.', 5, 'parentheses'],
    ['The heading "Release Overview" changed.', 4, 'quoted text'],
    ['The NASA report arrived.', 4, 'acronym'],
    ['The check took 30 ms.', 4, 'number with unit'],
    ['The suite has 30 tests.', 5, 'number with bare noun'],
    ['1. Run the command.', 3, 'numbered step'],
    ['- Check the workspace state.', 4, 'bulleted step'],
  ]

  for (const [sentence, expected, label] of cases) {
    assert.equal(countSteWords(sentence), expected, label)
  }
})

test('sentence split ends a sentence at a list colon and protects a decimal (STE 8.4)', () => {
  assert.deepEqual(splitSentences('Obey these rules:'), ['Obey these rules:'])
  assert.deepEqual(splitSentences('The gate passed. The run continued.'), [
    'The gate passed.',
    'The run continued.',
  ])
  assert.equal(splitSentences('Version 2.18.0 shipped today.').length, 1)
})

test('prose extraction skips fenced code, tables, blockquotes, and headings', () => {
  const markdown = [
    '# A heading that is far too long to obey any sentence limit at all here',
    '',
    '```sh',
    "this fenced line has a semicolon; and a contraction that doesn't count",
    '```',
    '',
    '| column | value |',
    '| --- | --- |',
    "| a | doesn't count |",
    '',
    "> Quoted evidence doesn't count either.",
    '',
    'The run finished.',
  ].join('\n')

  const paragraphs = extractMarkdownProse(markdown)

  assert.equal(paragraphs.length, 1)
  assert.equal(paragraphs[0].sentences[0].text, 'The run finished.')
  assert.deepEqual(codes(markdown), [])
})

test('an imperative sentence uses the 20-word instruction limit (STE 5.1)', () => {
  const instruction =
    'Run the validate command and then check the workspace state and then report the outcome to the operator before tomorrow morning.'

  assert.ok(countSteWords(instruction) > 20)
  assert.ok(countSteWords(instruction) <= 25)

  const issues = analyzeSimplifiedEnglish(extractMarkdownProse(instruction))
  const tooLong = issues.find((issue) => issue.code === 'ste.sentence_too_long')

  assert.ok(tooLong)
  assert.match(tooLong.message, /STE 5\.1/u)
  assert.match(tooLong.message, /instruction/u)

  const explanation =
    'The validate command reported one hard failure and the operator must decide whether the run continues or stops before the next stage begins again tomorrow morning.'

  assert.ok(countSteWords(explanation) > 25)

  const explanationIssues = analyzeSimplifiedEnglish(
    extractMarkdownProse(explanation),
  )
  const explanationTooLong = explanationIssues.find(
    (issue) => issue.code === 'ste.sentence_too_long',
  )

  assert.ok(explanationTooLong)
  assert.match(explanationTooLong.message, /STE 6\.3/u)
  assert.match(explanationTooLong.message, /explanation/u)

  assert.deepEqual(codes('Run the command.'), [])
  assert.deepEqual(codes('The gate passed and the run continued.'), [])
})

test('a paragraph of more than six sentences is reported (STE 6.6)', () => {
  const paragraph =
    'The run started. The gate passed. The plan changed. The review found one defect. The operator approved. The stage closed. The run ended.'

  assert.ok(codes(paragraph).includes('ste.paragraph_too_long'))
  assert.ok(
    !codes(
      'The run started. The gate passed. The plan changed. The stage closed.',
    ).includes('ste.paragraph_too_long'),
  )
})

test('banned punctuation, contractions, and Latin abbreviations are reported', () => {
  assert.ok(
    codes('The gate failed; the run stopped.').includes('ste.semicolon'),
  )
  assert.ok(codes("The gate doesn't pass yet.").includes('ste.contraction'))
  assert.ok(
    codes('Pass a flag, e.g. the verbose flag.').includes(
      'ste.latin_abbreviation',
    ),
  )
  assert.ok(
    codes('The reviewer approved it and he closed the stage.').includes(
      'ste.gendered_pronoun',
    ),
  )
  assert.ok(codes('Ensure the tests pass.').includes('ste.word_substitution'))
  assert.ok(
    codes('The agent will utilize the shared helper.').includes(
      'ste.word_substitution',
    ),
  )
})

test('complex verb constructions are reported (STE 3.2)', () => {
  assert.ok(codes('The gate has failed twice.').includes('ste.complex_verb'))
  assert.ok(
    codes('The plan had been approved before.').includes('ste.complex_verb'),
  )
  assert.ok(codes('The gate is blocking the run.').includes('ste.complex_verb'))
  assert.ok(
    codes('The release is to be approved.').includes('ste.complex_verb'),
  )
  assert.ok(
    codes('The record must be signed today.').includes('ste.complex_verb'),
  )
  assert.deepEqual(codes('The gate failed twice.'), [])
})

test('HTML prose extraction reads brief body text and skips code', () => {
  const html = [
    '<main class="pc-brief" data-brief-type="implementation">',
    '<section data-section-semantic="executive-summary">',
    '<h2>Executive summary</h2>',
    '<p>The gate failed; the run stopped.</p>',
    "<pre><code>a semicolon; that doesn't count</code></pre>",
    '</section>',
    '</main>',
  ].join('\n')

  assert.deepEqual(
    analyzeSimplifiedEnglish(extractHtmlProse(html)).map((issue) => issue.code),
    ['ste.semicolon'],
  )
})

test('the validator passes a conformant Markdown artifact', () => {
  // validateSimplifiedEnglish reads only root and targetPath, so a bare
  // temporary root is enough.
  const root = scratchRoot()
  const target = writeArtifact(
    root,
    'runtime/review.md',
    [
      '# Review',
      '',
      'The review found one defect. The coder repaired it.',
      '',
      'Next action:',
      '',
      '- Run `./bin/pan validate` to confirm the repair.',
      '',
    ].join('\n'),
  )

  const result = validateSimplifiedEnglish(input(root, target))

  assert.equal(result.status, 'passed')
  assert.deepEqual(result.issues, [])

  const missing = validateSimplifiedEnglish(input(root, 'runtime/absent.md'))

  assert.equal(missing.status, 'failed')
  assert.equal(missing.issues[0].code, 'artifact.missing')

  const long = writeArtifact(
    root,
    'runtime/long.md',
    [
      '# Long',
      '',
      ...Array.from({ length: 60 }, () => 'A gate failed; it stopped.\n'),
    ].join('\n'),
  )
  const elided = validateSimplifiedEnglish(input(root, long))

  assert.equal(elided.status, 'failed')
  assert.equal(elided.issues.length, 51)
  assert.equal(elided.issues.at(-1)?.code, 'ste.issues_elided')
  assert.ok((elided.issues[0].line ?? 0) > 0)
})
