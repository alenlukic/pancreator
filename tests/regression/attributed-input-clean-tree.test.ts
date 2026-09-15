/**
 * `cumulus` cohort session, Pancreator v6.3.1, 2026-09-14.
 * `pan cohort integrate` refused twice with `COHORT_INTEGRATION_INCOMPLETE`,
 * once for the chunk worktree and once for the base checkout `lean-mvp`. In
 * both cases the sole dirty path was `docs/mvp/cumulus-spec-2026-09-13.html`,
 * an untracked design source the operator had decided stays untracked and the
 * supervisor had recorded with `pan attribute`. The harness held a durable
 * record of the path's provenance and of the instruction that it must never
 * be committed, and the gate reduced the question to `git status` being
 * non-empty. The supervisor moved both copies to `/tmp` to satisfy a check
 * its own records had already answered.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  initCohortSession,
  integrateCohort,
  startCohort,
} from '../../src/lib/cohorts.js'
import { gitWorktreeIsDirty } from '../../src/lib/git.js'
import { loadState } from '../../src/lib/state.js'
import { recordWorkspaceAttribution } from '../../src/lib/workspace-attribution.js'
import { createFixture } from '../fixture-template.js'
import {
  commitInChunk,
  git,
  markSucceeded,
  ratifiedPlanRun,
} from '../integration/cohort-helpers.js'

const DESIGN_SOURCE = 'docs/mvp/cumulus-spec-2026-09-13.html'
const DESIGN_CONTENT = '<html><body>MVP specification</body></html>\n'

/** Place the untracked design source the operator exported. */
function placeDesignSource(checkout: string): void {
  mkdirSync(path.join(checkout, path.dirname(DESIGN_SOURCE)), {
    recursive: true,
  })
  writeFileSync(path.join(checkout, DESIGN_SOURCE), DESIGN_CONTENT)
}

test('an attributed read-only design source in both checkouts no longer refuses integration', () => {
  const root = createFixture()
  const planRunId = ratifiedPlanRun(root, [
    { id: 'foundation-registry', cohort_index: 1 },
    { id: 'extraction', cohort_index: 2, depends_on: ['foundation-registry'] },
  ])
  const session = initCohortSession(root, { planRunId })
  const started = startCohort(root, session.cohort_id)
  const chunkWorkspace = loadState(
    root,
    started.chunks[0].run_id,
  ).workspace_root
  const chunkPath = path.join(root, chunkWorkspace)

  commitInChunk(root, chunkWorkspace, 'foundation-registry')
  markSucceeded(root, started.chunks[0].run_id)
  git(root, ['add', '-A'])
  git(root, ['commit', '-m', 'chore: cohort baseline'])

  // The operator decided the design source stays untracked on main, and the
  // supervisor placed a copy in each checkout under that directive.
  placeDesignSource(root)
  placeDesignSource(chunkPath)

  recordWorkspaceAttribution(root, {
    workspacePath: root,
    runId: started.chunks[0].run_id,
    actingRole: 'supervisor',
    directive:
      `Placed a copy of the untracked design source ${DESIGN_SOURCE} per ` +
      'plan-approval note item 4. Read-only input to the extraction step; ' +
      'the file stays untracked on main by operator choice and must not be ' +
      'committed by the chunk.',
    disposition: 'read-only-input',
    paths: [DESIGN_SOURCE],
    artifactPath: `runtime/logs/workflows/${started.chunks[0].run_id}/agent/evidence/workspace-directive-1.md`,
  })

  // The pre-change signal still fires in both checkouts, so the integration
  // below succeeds because the gate reads the attribution record and not
  // because the tree happens to be empty.
  assert.equal(gitWorktreeIsDirty(root), true)
  assert.equal(gitWorktreeIsDirty(chunkPath), true)

  const integration = integrateCohort(root, session.cohort_id)

  assert.deepEqual(integration.merged_chunks, ['foundation-registry'])
  assert.equal(
    integration.evidence_path,
    `runtime/logs/cohorts/${session.cohort_id}/integration-1.json`,
  )
  assert.ok(existsSync(path.join(root, integration.evidence_path)))

  // No operator moved a file: both copies are where they were placed, and
  // the merge staged neither one.
  assert.equal(
    readFileSync(path.join(root, DESIGN_SOURCE), 'utf8'),
    DESIGN_CONTENT,
  )
  assert.equal(
    readFileSync(path.join(chunkPath, DESIGN_SOURCE), 'utf8'),
    DESIGN_CONTENT,
  )
  assert.doesNotMatch(
    git(root, ['log', '--name-only', '--pretty=format:']),
    /cumulus-spec-2026-09-13\.html/u,
  )
})
