import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

export const CLI = path.join(process.cwd(), 'dist', 'src', 'cli.js')

export interface CreatedWorktree {
  status: 'created'
  worktree: {
    name: string
    path: string
    branch: string
    created_from: string
    description: string
    created_at: string
  }
}

export function git(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

export function runCli<T>(root: string, args: string[]): T {
  return JSON.parse(
    execFileSync(process.execPath, [CLI, ...args, '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120_000,
    }),
  ) as T
}

export function createWorktree(
  root: string,
  name: string,
  options: string[] = [],
): CreatedWorktree['worktree'] {
  return runCli<CreatedWorktree>(root, ['worktree', 'create', name, ...options])
    .worktree
}

export function commitFile(
  worktreePath: string,
  filename: string,
  content: string,
): string {
  writeFileSync(path.join(worktreePath, filename), content)
  git(worktreePath, ['add', filename])
  git(worktreePath, ['commit', '-qm', `add ${filename}`])

  return git(worktreePath, ['rev-parse', 'HEAD']).trim()
}
