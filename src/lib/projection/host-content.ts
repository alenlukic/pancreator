/**
 * Renderers for VS Code and Copilot CLI projection targets. Each one converts
 * a canonical source that Cursor also projects, so both hosts keep one source.
 *
 * Kept in sync with the equivalent renderers in `bin/install-support`, which
 * cannot import this module during an embedded install.
 */

import { invariant } from '../errors.js'

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/u

/** VS Code and Copilot CLI ignore a skill or agent description past this. */
const DESCRIPTION_LIMIT = 1024

interface FrontmatterDocument {
  description: string | null
  body: string
}

function splitFrontmatter(content: string): FrontmatterDocument {
  const match = FRONTMATTER.exec(content)

  if (!match) {
    return { description: null, body: content }
  }

  const description = /^description:\s*(.+)$/mu.exec(match[1] ?? '')?.[1]

  return {
    description: description === undefined ? null : unquote(description),
    body: content.slice(match[0].length),
  }
}

function unquote(value: string): string {
  const trimmed = value.trim()

  if (trimmed.startsWith('"')) {
    return JSON.parse(trimmed) as string
  }

  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'")
  }

  return trimmed
}

/** A YAML double-quoted scalar; JSON string syntax is valid YAML. */
function yamlString(value: string): string {
  return JSON.stringify(value)
}

function limitDescription(value: string): string {
  return value.length <= DESCRIPTION_LIMIT
    ? value
    : `${value.slice(0, DESCRIPTION_LIMIT - 1)}…`
}

/** The first sentence of the first paragraph, on one line. */
function firstSentence(body: string): string {
  const paragraph = (body.trim().split(/\n\s*\n/u)[0] ?? '')
    .replace(/\s+/gu, ' ')
    .trim()
  const sentence = /^(.+?[.!?])(?:\s|$)/u.exec(paragraph)?.[1]

  return sentence ?? paragraph
}

/**
 * Render a Cursor `.mdc` rule as a VS Code instruction file that applies to
 * every request.
 */
export function renderVscodeInstructions(content: string): string {
  const { description, body } = splitFrontmatter(content)

  return [
    '---',
    ...(description === null
      ? []
      : [`description: ${yamlString(limitDescription(description))}`]),
    "applyTo: '**'",
    '---',
    body,
  ].join('\n')
}

/**
 * Render an operator command as a slash-only skill. The skill `name` MUST
 * equal its folder name, or VS Code and Copilot CLI skip it without an error.
 */
export function renderCommandSkill(name: string, content: string): string {
  invariant(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name),
    `skill name '${name}' MUST be lowercase alphanumeric with single hyphens`,
    { code: 'INVALID_PROJECTION_MANIFEST' },
  )

  const arguments_ = content.includes('$ARGUMENTS')
    ? [
        `\`$ARGUMENTS\` in these instructions stands for the text the operator typed after \`/${name}\`.`,
        '',
      ]
    : []

  return [
    '---',
    `name: ${name}`,
    `description: ${yamlString(limitDescription(firstSentence(content)))}`,
    'disable-model-invocation: true',
    '---',
    '',
    ...arguments_,
    content,
  ].join('\n')
}

/**
 * Render a persona as a VS Code and Copilot CLI custom agent. The model and
 * the tool boundary come from the executor command line, so the file names
 * neither; `user-invocable: false` keeps workers out of the agent picker.
 */
export function renderVscodeAgent(persona: string, content: string): string {
  const { description, body } = splitFrontmatter(content)

  invariant(
    description !== null,
    `persona ${persona} agent source MUST carry a description`,
    { code: 'INVALID_CURSOR_AGENT' },
  )

  return [
    '---',
    `name: pan-${persona}`,
    `description: ${yamlString(limitDescription(description))}`,
    'user-invocable: false',
    '---',
    body,
  ].join('\n')
}

/**
 * Replace each backticked Cursor tool name with the same host tool term's name
 * on another host. A term the other host lacks keeps its Cursor name.
 */
export function translateHostToolNames(
  content: string,
  replacements: ReadonlyArray<readonly [string, string]>,
): string {
  return replacements.reduce(
    (text, [cursorName, hostName]) =>
      text.replaceAll(`\`${cursorName}\``, `\`${hostName}\``),
    content,
  )
}
