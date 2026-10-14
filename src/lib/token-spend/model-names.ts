/** Readable display names for Cursor model ids in spend output. */

const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh'])
const EFFORT_WORDS: Record<string, string> = { xhigh: 'extra high' }
const BRANDS: Record<string, string> = {
  gpt: 'GPT',
  default: 'Auto',
}

function brandWord(word: string): string {
  return BRANDS[word] ?? `${word.charAt(0).toUpperCase()}${word.slice(1)}`
}

/**
 * `claude-opus-5-thinking-high-fast` reads `Claude Opus 5 (high thinking,
 * Fast)`, `gpt-5.6-sol-high` reads `GPT-5.6 Sol (high effort)`, and
 * `claude-fable-5-1-thinking-high` reads `Claude Fable 5.1 (high thinking)`.
 * A name this cannot split is returned unchanged.
 */
export function spendModelName(model: string): string {
  if (!/^[a-z0-9.]+(?:-[a-z0-9.]+)*$/u.test(model)) {
    return model
  }

  const words = model
    .split('-')
    .filter(
      (word, index, all) =>
        !(index === 0 && word === 'cursor' && all.length > 1),
    )
  const name: string[] = []
  let effort: string | null = null
  let thinking = false
  let fast = false

  for (const word of words) {
    if (EFFORTS.has(word)) {
      effort = EFFORT_WORDS[word] ?? word
    } else if (word === 'thinking') {
      thinking = true
    } else if (word === 'fast') {
      fast = true
    } else if (
      /^\d+$/u.test(word) &&
      /^\d+(?:\.\d+)*$/u.test(name.at(-1) ?? '')
    ) {
      name[name.length - 1] = `${name.at(-1)}.${word}`
    } else {
      name.push(word)
    }
  }

  const [first, ...rest] = name
  const head =
    first === 'gpt' && rest.length > 0 && /^\d/u.test(rest[0] ?? '')
      ? [`GPT-${rest.shift()}`]
      : first === undefined
        ? []
        : [brandWord(first)]
  const base = [...head, ...rest.map(brandWord)].join(' ')
  const qualifiers = [
    effort === null
      ? thinking
        ? 'thinking'
        : null
      : `${effort} ${thinking ? 'thinking' : 'effort'}`,
    fast ? 'Fast' : null,
  ].filter((part): part is string => part !== null)

  return base === ''
    ? model
    : qualifiers.length > 0
      ? `${base} (${qualifiers.join(', ')})`
      : base
}
