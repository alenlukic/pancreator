import path from 'node:path'

import { invariant, PanError } from '../errors.js'
import { isFile, isRecord, readText } from '../io.js'

/**
 * Whether a line of text uses a harness facility or merely mentions it.
 *
 * `functional` covers an invocation, a direction to run, read, apply, or
 * follow the facility, and a statement that the facility governs the reader's
 * conduct. `incidental` covers everything else: a question about it, a pasted
 * report that names it, an index or enumeration entry, a description of what
 * it does, evidence from a run that used it, and a change request that edits
 * it. Only a functional line is usage evidence in the debloat scan.
 */
export type IntentLabel = 'functional' | 'incidental'

export interface IntentExample {
  text: string
  label: IntentLabel
  /** Where the example was harvested from, for the corpus reader. */
  source?: string
}

export interface IntentVerdict {
  functional: boolean
  /** Signed decision margin. Positive is functional, larger is more certain. */
  margin: number
}

export interface IntentClassifier {
  classify(text: string): IntentVerdict
  readonly exampleCount: number
}

/**
 * The labeled corpus the classifier trains from.
 *
 * One JSON object per line: `{"text": ..., "label": ..., "source": ...}`. The
 * examples were adjudicated by hand from operator transcripts, inbox requests,
 * repository instruction files, and the Git history of those files, so the
 * corpus rather than a weights file is the reviewed artifact.
 */
export const INTENT_CORPUS_PATH = 'library/debloat/intent-corpus.jsonl'

const EPOCHS = 30
const LEARNING_RATE = 0.1
const L2 = 1e-4
const MAX_WORDS = 60

const POLICY_ID_PATTERN = /^[a-z]+-\d{3}$/u
const WORD_PATTERN = /[a-z][a-z0-9_'-]*/gu

function lengthBucket(length: number): string {
  if (length < 25) {
    return 'xs'
  }

  if (length < 60) {
    return 's'
  }

  if (length < 140) {
    return 'm'
  }

  if (length < 300) {
    return 'l'
  }

  return 'xl'
}

/**
 * Sparse binary features of one line.
 *
 * Structural features come first, because the shape of a line settles most
 * cases before its words do: a slash command, a command line, a table row, a
 * JSON key, a heading, and a bare path each carry their own signal. Word
 * unigrams and bigrams follow, with policy ids and `pan-` names collapsed to
 * placeholders so the model learns the verb around a facility rather than the
 * facility itself.
 */
export function intentFeatures(text: string): string[] {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()
  const features: string[] = []

  if (/^\/pan-/u.test(trimmed)) {
    features.push('^slash')
  }

  if (
    /^(?:cd \S+ && )?(?:\.\/|\.\/\.pancreator\/)?(?:bin\/)?pan\s/u.test(trimmed)
  ) {
    features.push('^cmd')
  }

  if (/^[-*+]\s/u.test(trimmed)) {
    features.push('^bullet')
  }

  if (/^\d+[.)]\s/u.test(trimmed)) {
    features.push('^numbered')
  }

  if (trimmed.startsWith('#')) {
    features.push('^heading')
  }

  if (trimmed.startsWith('|')) {
    features.push('^table')
  }

  if (/^"[a-z_]+"\s*:/u.test(trimmed)) {
    features.push('^jsonkv')
  }

  if (trimmed.startsWith('"')) {
    features.push('^quoted')
  }

  if (trimmed.startsWith('>')) {
    features.push('^quote')
  }

  if (/^[-*+]?\s*`[^`]+`[,.]?\s*$/u.test(trimmed)) {
    features.push('^barecode')
  }

  if (trimmed.startsWith('**')) {
    features.push('^bold')
  }

  if (trimmed.startsWith('{')) {
    features.push('^json')
  }

  if (trimmed.includes('?')) {
    features.push('has_q')
  }

  if (trimmed.includes('**')) {
    features.push('has_bold')
  }

  if (trimmed.includes('MUST NOT') || lower.includes('must not')) {
    features.push('has_mustnot')
  } else if (trimmed.includes('MUST')) {
    features.push('has_must')
  }

  if (/`[^`]*\/[^`]*`/u.test(trimmed)) {
    features.push('has_path')
  }

  if (lower.includes('sha256:')) {
    features.push('has_sha')
  }

  if (trimmed.includes('—')) {
    features.push('has_emdash')
  }

  features.push(`len_${lengthBucket(trimmed.length)}`)

  if (trimmed.endsWith(':')) {
    features.push('ends_colon')
  }

  const words: string[] = []

  for (const match of lower.matchAll(WORD_PATTERN)) {
    const word = match[0]

    if (POLICY_ID_PATTERN.test(word)) {
      words.push('<policy>')
    } else if (word.startsWith('pan-')) {
      words.push('<pan-name>')
    } else {
      words.push(word)
    }

    if (words.length >= MAX_WORDS) {
      break
    }
  }

  if (words.length > 0) {
    features.push(`first=${words[0]}`)
  }

  if (words.length > 1) {
    features.push(`second=${words[1]}`)
  }

  for (const word of words) {
    features.push(`w=${word}`)
  }

  for (let index = 1; index < words.length; index += 1) {
    features.push(`b=${words[index - 1]}_${words[index]}`)
  }

  return features
}

function sigmoid(value: number): number {
  const bounded = Math.max(-30, Math.min(30, value))

  return 1 / (1 + Math.exp(-bounded))
}

/**
 * Train a logistic-regression classifier over the corpus.
 *
 * Plain stochastic gradient descent with a fixed epoch count, a fixed
 * learning rate, and a fixed visiting order, so the same corpus always
 * produces the same weights and the scan stays deterministic. The visiting
 * order strides through the examples with a coprime step so the model does not
 * see the corpus in file order every epoch.
 */
export function trainIntentClassifier(
  examples: readonly IntentExample[],
): IntentClassifier {
  invariant(examples.length > 0, 'The intent corpus holds no examples.', {
    code: 'DEBLOAT_INTENT_CORPUS_EMPTY',
  })

  const prepared = examples.map((example) => ({
    features: [...new Set(intentFeatures(example.text))],
    target: example.label === 'functional' ? 1 : 0,
  }))
  const weights = new Map<string, number>()
  let bias = 0
  const count = prepared.length

  for (let epoch = 0; epoch < EPOCHS; epoch += 1) {
    for (let step = 0; step < count; step += 1) {
      const sample = prepared[(step * 7 + epoch) % count]

      if (!sample) {
        continue
      }

      let activation = bias

      for (const feature of sample.features) {
        activation += weights.get(feature) ?? 0
      }

      const gradient = sigmoid(activation) - sample.target

      for (const feature of sample.features) {
        const current = weights.get(feature) ?? 0

        weights.set(
          feature,
          current - LEARNING_RATE * (gradient + L2 * current),
        )
      }

      bias -= LEARNING_RATE * gradient
    }
  }

  const cache = new Map<string, IntentVerdict>()

  return {
    exampleCount: count,
    classify(text: string): IntentVerdict {
      const key = text.trim()
      const cached = cache.get(key)

      if (cached) {
        return cached
      }

      let margin = bias

      for (const feature of new Set(intentFeatures(key))) {
        margin += weights.get(feature) ?? 0
      }

      const verdict = { functional: margin > 0, margin }

      cache.set(key, verdict)

      return verdict
    },
  }
}

function parseExample(line: string, lineNumber: number): IntentExample {
  let value: unknown

  try {
    value = JSON.parse(line)
  } catch {
    throw new PanError(
      `${INTENT_CORPUS_PATH}:${lineNumber} is not a JSON object.`,
      { code: 'DEBLOAT_INTENT_CORPUS_INVALID' },
    )
  }

  invariant(
    isRecord(value) &&
      typeof value.text === 'string' &&
      value.text.trim().length > 0 &&
      (value.label === 'functional' || value.label === 'incidental'),
    `${INTENT_CORPUS_PATH}:${lineNumber} needs a non-empty text and a ` +
      'label of functional or incidental.',
    { code: 'DEBLOAT_INTENT_CORPUS_INVALID' },
  )

  return {
    text: value.text,
    label: value.label,
    ...(typeof value.source === 'string' ? { source: value.source } : {}),
  }
}

/** Read the labeled corpus from the installation root. */
export function loadIntentCorpus(root: string): IntentExample[] {
  const absolute = path.join(root, INTENT_CORPUS_PATH)

  invariant(
    isFile(absolute),
    `The intent corpus is missing at ${INTENT_CORPUS_PATH}. The debloat ` +
      'scan cannot separate functional usage from a mention without it.',
    { code: 'DEBLOAT_INTENT_CORPUS_MISSING' },
  )

  const examples: IntentExample[] = []

  readText(absolute)
    .split('\n')
    .forEach((line, index) => {
      if (line.trim().length > 0) {
        examples.push(parseExample(line, index + 1))
      }
    })

  return examples
}

const classifiers = new Map<string, IntentClassifier>()

/**
 * The classifier trained from the root's corpus, trained once per process.
 *
 * Training costs a fraction of a second, but the scan classifies tens of
 * thousands of lines and the impact step rebuilds the graph, so one trained
 * model per root is shared.
 */
export function loadIntentClassifier(root: string): IntentClassifier {
  const key = path.resolve(root)
  const existing = classifiers.get(key)

  if (existing) {
    return existing
  }

  const classifier = trainIntentClassifier(loadIntentCorpus(root))

  classifiers.set(key, classifier)

  return classifier
}

const INFORMATION_OPENER =
  /^(?:what|how|why|when|where|which|who|whom|whose|is|are|was|were|does|do|did|can|could|would|should|will|has|have|explain|summarize|summarise|describe|clarify|compare|tell me|walk me|remind me|help me understand|i don'?t (?:understand|see|get|follow)|i'?m not (?:sure|seeing|clear)|so |curious)\b/iu

/**
 * Whether an operator turn asks for information rather than for work.
 *
 * An agent that reads a facility while answering a question is not using it,
 * so a lookup made under an information request is not usage evidence. The
 * test reads the first content line of the turn: a question mark, or an
 * interrogative or explanatory opener, marks the turn as informational. A
 * turn that opens with a slash command is never informational, whatever
 * follows the command.
 */
export function isInformationRequest(text: string): boolean {
  const first =
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ''

  if (first.startsWith('/')) {
    return false
  }

  if (first.includes('?')) {
    return true
  }

  return INFORMATION_OPENER.test(first)
}
