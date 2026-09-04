import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Test fixtures allocate scratch space through tests/temp.ts, which places
// them under the root where bin/run-tests removes them after every run. A
// fixture created in the shared OS temp directory instead outlives the run,
// and the leak compounds: 166,000 of them once sat in one developer's temp
// directory and slowed every create and unlink there for every program on the
// host. The audit rejects the call that starts that leak so it cannot recur.
const PERMITTED = new Set(['tests/temp.ts'])
const SHARED_TEMP_CALL = /\btmpdir\s*\(/u

export interface TestScratchAuditResult {
  errors: string[]
}

function listTypeScriptFiles(directory: string, out: string[]): void {
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry)

    if (statSync(full).isDirectory()) {
      listTypeScriptFiles(full, out)
    } else if (entry.endsWith('.ts')) {
      out.push(full)
    }
  }
}

/** Reject test sources that allocate scratch space in the shared temp directory. */
export function auditTestScratchDirectories(
  root: string,
): TestScratchAuditResult {
  const errors: string[] = []
  const testsRoot = path.join(root, 'tests')
  const files: string[] = []

  try {
    if (!statSync(testsRoot).isDirectory()) {
      return { errors }
    }
  } catch {
    return { errors }
  }

  listTypeScriptFiles(testsRoot, files)

  for (const file of files.sort()) {
    const relative = path.relative(root, file).split(path.sep).join('/')

    if (PERMITTED.has(relative)) {
      continue
    }

    const lines = readFileSync(file, 'utf8').split('\n')

    lines.forEach((line, index) => {
      if (SHARED_TEMP_CALL.test(line)) {
        errors.push(
          `${relative}:${index + 1} allocates in the shared temp directory with tmpdir(); use createTestTempDirectory from tests/temp.ts`,
        )
      }
    })
  }

  return { errors }
}
