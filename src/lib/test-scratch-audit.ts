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
const RUN_CONSTRUCTION = /\b(?:createRun|prepareInvocation)\s*\(/u
const CHECKPOINT_CLONE = /\bcheckpoint\s*\(/u
const CHILD_PROCESS_IMPORT =
  /from\s+['"]node:child_process['"]|require\s*\(\s*['"]node:child_process['"]\s*\)/u
const WRITABLE_FIXTURE = /\b(?:createFixture|checkpoint)\s*\(/u

/**
 * Hand-built run drivers that no checkpoint covers yet.
 *
 * This explicit list is the reviewed migration boundary: a new hand-built
 * driver fails validation until it either adopts a checkpoint or is added in
 * a deliberate review. Every entry is existing debt rather than a permanent
 * exemption, and the chunk that introduced the rule owns draining it: a file
 * leaves this list when someone converts it to `checkpoint()`, and nothing
 * joins it without a reviewed change to this file.
 */
const RUN_CONSTRUCTION_ALLOWLIST = new Set([
  'tests/integration/away-mode.test.ts',
  'tests/integration/best-of-n-helpers.ts',
  'tests/integration/best-of-n.test.ts',
  'tests/integration/claude-code-executor.test.ts',
  'tests/integration/cli-help.test.ts',
  'tests/integration/cohort-fanout-start.test.ts',
  'tests/integration/cohort-helpers.ts',
  'tests/integration/cohort-integration-conflicts.test.ts',
  'tests/integration/cohort-integration.test.ts',
  'tests/integration/cohorts.test.ts',
  'tests/integration/delivery-inbox-states.test.ts',
  'tests/integration/delivery-verify-routing.test.ts',
  'tests/integration/entry-gate-known-failing.test.ts',
  'tests/integration/eval-cli.test.ts',
  'tests/integration/evidence-path-attempts.test.ts',
  'tests/integration/gate-cache.test.ts',
  'tests/integration/hypervisor-cli.test.ts',
  'tests/integration/non-git-workflow.test.ts',
  'tests/integration/openai-executor-guards.test.ts',
  'tests/integration/openai-executor.test.ts',
  'tests/integration/operator-artifact-generation.test.ts',
  'tests/integration/operator-involvement-helpers.ts',
  'tests/integration/operator-involvement-profiles.test.ts',
  'tests/integration/operator-layout.test.ts',
  'tests/integration/planning-workflow.test.ts',
  'tests/integration/prototype-helpers.ts',
  'tests/integration/release-preparation.test.ts',
  'tests/integration/repository-checks.test.ts',
  'tests/integration/runtime-archive-cli.test.ts',
  'tests/integration/set-stage-inflight-worker.test.ts',
  'tests/integration/state.test.ts',
  'tests/integration/submit-advisories.test.ts',
  'tests/integration/workspace-target.test.ts',
  'tests/integration/worktree-cli-runs.test.ts',
  'tests/regression/delivery-old-graph.test.ts',
  'tests/regression/event-recovery.test.ts',
  'tests/regression/ledger-provenance.test.ts',
  'tests/regression/read-only-mutation.test.ts',
  'tests/regression/run-friction.test.ts',
  'tests/regression/supervisor-delegation-contract.test.ts',
  'tests/regression/undelegated-work-actor.test.ts',
  'tests/run-helpers.ts',
])

/**
 * Unit-lane exceptions, of which there are none.
 *
 * Every unit-lane file either reads the shared fixture or lives in the lane
 * its cost belongs to, so an entry here is now a reviewed regression rather
 * than inherited debt.
 */
const UNIT_LANE_ALLOWLIST = new Set<string>()

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
    const source = readFileSync(file, 'utf8')

    const lines = source.split('\n')

    if (!PERMITTED.has(relative)) {
      lines.forEach((line, index) => {
        if (!SHARED_TEMP_CALL.test(line)) {
          return
        }

        errors.push(
          `${relative}:${index + 1} allocates in the shared temp directory with tmpdir(); use createTestTempDirectory from tests/temp.ts`,
        )
      })
    }

    if (
      RUN_CONSTRUCTION.test(source) &&
      !CHECKPOINT_CLONE.test(source) &&
      !RUN_CONSTRUCTION_ALLOWLIST.has(relative)
    ) {
      errors.push(
        `${relative} constructs or prepares a run without cloning a checkpoint; use checkpoint() from tests/integration/delivery-helpers.ts or add a reviewed allowlist entry`,
      )
    }

    if (
      relative.startsWith('tests/unit/') &&
      (CHILD_PROCESS_IMPORT.test(source) || WRITABLE_FIXTURE.test(source)) &&
      !UNIT_LANE_ALLOWLIST.has(relative)
    ) {
      errors.push(
        `${relative} crosses the unit-lane boundary with a subprocess or writable fixture; move it to tests/integration or use sharedFixture() for read-only access`,
      )
    }
  }

  return { errors }
}
