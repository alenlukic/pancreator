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
import { createFixture } from '../helpers.js'

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
  assert.equal(countSteWords('Run `./bin/pan validate` to check the state.'), 6)
})

test('word count treats a path, a flag, and an identifier as one word each', () => {
  assert.equal(countSteWords('The gate for policy STE-001 failed.'), 6)
  assert.equal(countSteWords('Read governance/policies/STE-001.json now.'), 3)
  assert.equal(countSteWords('Pass --involvement to the command.'), 5)
})

test('word count treats a hyphenated word as one word (STE 8.7)', () => {
  assert.equal(countSteWords('The main-gear-door handle moved.'), 4)
})

test('word count treats text in parentheses as one word (STE 8.5)', () => {
  assert.equal(
    countSteWords('The stage closed (the operator approved it) today.'),
    5,
  )
})

test('word count treats quoted text and an acronym as one word (STE 8.6)', () => {
  assert.equal(countSteWords('The heading "Release Overview" changed.'), 4)
  assert.equal(countSteWords('The NASA report arrived.'), 4)
})

test('word count joins a number with its unit but not with a bare noun (STE 8.6)', () => {
  assert.equal(countSteWords('The check took 30 ms.'), 4)
  assert.equal(countSteWords('The suite has 30 tests.'), 5)
})

test('word count ignores a step number but counts remaining words (STE 8.6)', () => {
  assert.equal(countSteWords('1. Run the command.'), 3)
  assert.equal(countSteWords('- Check the workspace state.'), 4)
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
})

test('an explanation sentence uses the 25-word limit (STE 6.3)', () => {
  const explanation =
    'The validate command reported one hard failure and the operator must decide whether the run continues or stops before the next stage begins again tomorrow morning.'

  assert.ok(countSteWords(explanation) > 25)

  const issues = analyzeSimplifiedEnglish(extractMarkdownProse(explanation))
  const tooLong = issues.find((issue) => issue.code === 'ste.sentence_too_long')

  assert.ok(tooLong)
  assert.match(tooLong.message, /STE 6\.3/u)
  assert.match(tooLong.message, /explanation/u)
})

test('a sentence at the limit reports no length issue', () => {
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

test('gender-specific pronouns and word substitutions are reported', () => {
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
  const root = createFixture()
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
})

test('the validator reports a missing artifact', () => {
  const root = createFixture()
  const result = validateSimplifiedEnglish(input(root, 'runtime/absent.md'))

  assert.equal(result.status, 'failed')
  assert.equal(result.issues[0].code, 'artifact.missing')
})

test('the validator reports a line number and elides beyond the ceiling', () => {
  const root = createFixture()
  const target = writeArtifact(
    root,
    'runtime/long.md',
    [
      '# Long',
      '',
      ...Array.from({ length: 60 }, () => 'A gate failed; it stopped.\n'),
    ].join('\n'),
  )

  const result = validateSimplifiedEnglish(input(root, target))

  assert.equal(result.status, 'failed')
  assert.equal(result.issues.length, 51)
  assert.equal(result.issues.at(-1)?.code, 'ste.issues_elided')
  assert.ok((result.issues[0].line ?? 0) > 0)
})
