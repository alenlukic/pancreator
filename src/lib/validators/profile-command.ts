import path from 'node:path'
import { loadRepositoryChecks } from '../repository-checks.js'

/** Parse literal shell words, without expansion or execution. */
function commandWords(command: string): string[] | null {
  const words: string[] = []
  let word = ''
  let quote = ''
  let started = false

  for (let index = 0; index < command.length; index++) {
    const character = command[index]

    if (character === '\\' && quote !== "'") {
      const next = command[++index]

      if (next === undefined) {
        return null
      }

      word += next
      started = true
    } else if (quote) {
      if (character === quote) {
        quote = ''
      } else {
        word += character
      }
    } else if (character === '"' || character === "'") {
      quote = character
      started = true
    } else if (/\s/u.test(character)) {
      if (started) {
        words.push(word)
        word = ''
        started = false
      }
    } else if (/[;&|<>$`]/u.test(character)) {
      return null
    } else {
      word += character
      started = true
    }
  }

  if (quote) {
    return null
  }

  if (started) {
    words.push(word)
  }

  return words
}

function canonicalCommand(root: string, argv: string[], cwd: string): string[] {
  const [binary, ...args] = argv
  const name = path.basename(binary ?? '')

  if (['npm', 'pnpm', 'yarn', 'bun'].includes(name)) {
    return ['package-script', ...(args[0] === 'run' ? args.slice(1) : args)]
  }

  const executable = binary?.includes('/')
    ? path.resolve(root, cwd, binary)
    : (binary ?? '')

  return [executable, ...args]
}

/** Compare executable identity and argument boundaries on both sides. */
export function profileCommandInArgv(
  root: string,
  argv: string[],
  cwd = '.',
  workspaceRoot = root,
): { profile: string; command: string } | null {
  const candidate = canonicalCommand(workspaceRoot, argv, cwd)

  for (const [profile, definition] of Object.entries(
    loadRepositoryChecks(root).profiles,
  )) {
    for (const command of definition.commands) {
      const words = commandWords(command)

      if (!words?.length) {
        continue
      }

      const configured = canonicalCommand(workspaceRoot, words, '.')

      if (
        configured.every((argument, index) => argument === candidate[index])
      ) {
        return { profile, command }
      }
    }
  }

  if (
    path.basename(argv[0] ?? '') === 'pan' &&
    argv[1] === 'repository-check' &&
    argv[2] &&
    argv[2] !== 'validate'
  ) {
    return { profile: argv[2], command: `pan repository-check ${argv[2]}` }
  }

  return null
}

/** Identify configured profile commands without executing free text. */
export function profileCommandInText(
  root: string,
  text: string,
  strict = false,
): { profile: string; command: string } | null {
  let profiles: Record<string, { commands: string[] }>
  try {
    profiles = loadRepositoryChecks(root).profiles
  } catch (error) {
    if (strict) throw error
    return null
  }
  const boundary = String.raw`(?:^|[\s\x60'"(;&|])`
  const terminal = String.raw`(?:$|[\s\x60'");&|])`
  for (const [profile, definition] of Object.entries(profiles)) {
    for (const command of definition.commands ?? []) {
      const escaped = command.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      if (new RegExp(`${boundary}${escaped}${terminal}`, 'u').test(text)) {
        return { profile, command }
      }
    }
    const literal = new RegExp(
      `${boundary}(?:\\./bin/)?pan repository-check ${profile}${terminal}`,
      'u',
    )
    if (literal.test(text)) {
      return { profile, command: `pan repository-check ${profile}` }
    }
  }
  const anyProfile = new RegExp(
    `${boundary}(?:\\./bin/)?pan repository-check ([a-z][a-z0-9_-]*)${terminal}`,
    'u',
  ).exec(text)
  if (anyProfile && anyProfile[1] !== 'validate') {
    return {
      profile: anyProfile[1],
      command: `pan repository-check ${anyProfile[1]}`,
    }
  }
  return null
}
