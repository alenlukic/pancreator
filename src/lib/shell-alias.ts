import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const PAN_FUNCTION_BEGIN = '# >>> pancreator pan >>>'
export const PAN_FUNCTION_END = '# <<< pancreator pan <<<'
export const LEGACY_BLOCK_BEGIN_PREFIX = '# >>> pancreator pan@'

export interface ShellRcCandidate {
  shell: 'bash' | 'zsh'
  path: string
}

export interface ConfigureShellAliasOptions {
  homeDir?: string
}

export interface ConfigureShellAliasResult {
  updated: string[]
  skipped: string[]
  messages: string[]
}

export interface PanWalkUpDependencies {
  pathExists: (filePath: string) => boolean
  readFile: (filePath: string) => string
}

export interface PanWalkUpMatch {
  kind: 'embedded' | 'self_development'
  panPath: string
  rootDir: string
}

export function shellRcCandidates(homeDir: string): ShellRcCandidate[] {
  return [
    { shell: 'zsh', path: path.join(homeDir, '.zshrc') },
    { shell: 'bash', path: path.join(homeDir, '.bashrc') },
  ]
}

export function resolvePanWalkUp(
  startDir: string,
  deps: PanWalkUpDependencies,
): PanWalkUpMatch | null {
  let dir = path.resolve(startDir)
  const root = path.parse(dir).root

  while (true) {
    const embeddedPan = path.join(dir, '.pancreator', 'bin', 'pan')

    if (deps.pathExists(embeddedPan)) {
      return { kind: 'embedded', panPath: embeddedPan, rootDir: dir }
    }

    const sourcePan = path.join(dir, 'bin', 'pan')
    const projectJson = path.join(dir, 'project.json')

    if (deps.pathExists(sourcePan) && deps.pathExists(projectJson)) {
      try {
        const config = JSON.parse(deps.readFile(projectJson)) as {
          installation_mode?: string
        }

        if (config.installation_mode === 'self_development') {
          return {
            kind: 'self_development',
            panPath: sourcePan,
            rootDir: dir,
          }
        }
      } catch {
        // Ignore invalid project.json and keep walking up.
      }
    }

    if (dir === root) {
      break
    }

    dir = path.dirname(dir)
  }

  return null
}

export function buildPanFunctionBlock(): string {
  return [
    PAN_FUNCTION_BEGIN,
    'pan() {',
    '  local dir="$PWD"',
    '  while [[ -n "$dir" ]]; do',
    '    if [[ -x "$dir/.pancreator/bin/pan" ]]; then',
    '      "$dir/.pancreator/bin/pan" "$@"',
    '      return $?',
    '    fi',
    '    if [[ -x "$dir/bin/pan" && -f "$dir/project.json" ]]; then',
    '      if node -e \'const fs=require("node:fs");const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.exit(c.installation_mode==="self_development"?0:1)\' "$dir/project.json" 2>/dev/null; then',
    '        "$dir/bin/pan" "$@"',
    '        return $?',
    '      fi',
    '    fi',
    '    [[ "$dir" == "/" ]] && break',
    '    dir="$(dirname "$dir")"',
    '  done',
    "  printf '%s\\n' 'pan: no Pancreator install found in the current directory tree.' >&2",
    '  return 127',
    '}',
    PAN_FUNCTION_END,
  ].join('\n')
}

export function removePanShellBlocks(content: string): string {
  const patterns = [
    new RegExp(
      `(?:^|\\n)${escapeRegExp(PAN_FUNCTION_BEGIN)}[\\s\\S]*?${escapeRegExp(PAN_FUNCTION_END)}(?=\\n|$)`,
      'gu',
    ),
    new RegExp(
      `(?:^|\\n)${escapeRegExp(LEGACY_BLOCK_BEGIN_PREFIX)}[^\\n]+ >>>[\\s\\S]*?# <<< pancreator pan@[^\\n]+ <<<(?=\\n|$)`,
      'gu',
    ),
  ]

  let next = content

  for (const pattern of patterns) {
    next = next.replace(pattern, '')
  }

  return next.replace(/\n{3,}/gu, '\n\n').trimEnd()
}

export function upsertPanFunctionBlock(content: string): string {
  const withoutBlocks = removePanShellBlocks(content)
  const block = buildPanFunctionBlock()

  if (withoutBlocks.length === 0) {
    return `${block}\n`
  }

  const separator = withoutBlocks.endsWith('\n') ? '' : '\n'

  return `${withoutBlocks}${separator}\n${block}\n`
}

export function countPanFunctionBlocks(content: string): number {
  const pattern = new RegExp(escapeRegExp(PAN_FUNCTION_BEGIN), 'gu')

  return (content.match(pattern) ?? []).length
}

export function configureShellAlias(
  options: ConfigureShellAliasOptions = {},
): ConfigureShellAliasResult {
  const homeDir = options.homeDir ?? os.homedir()
  const updated: string[] = []
  const skipped: string[] = []
  const messages: string[] = []

  for (const candidate of shellRcCandidates(homeDir)) {
    try {
      const existing = existsSync(candidate.path)
        ? readFileSync(candidate.path, 'utf8')
        : ''
      const next = upsertPanFunctionBlock(existing)

      if (existing === next) {
        skipped.push(candidate.path)
        messages.push(
          `pan shell function already configured in ${candidate.path}.`,
        )
        continue
      }

      if (existing.length === 0) {
        mkdirSync(path.dirname(candidate.path), { recursive: true })
      }

      writeFileSync(candidate.path, next, { encoding: 'utf8', mode: 0o644 })
      updated.push(candidate.path)
      messages.push(`Configured pan shell function in ${candidate.path}.`)
    } catch (error) {
      skipped.push(candidate.path)
      const reason = error instanceof Error ? error.message : String(error)

      messages.push(`Skipped ${candidate.path}: ${reason}`)
    }
  }

  return { updated, skipped, messages }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}
