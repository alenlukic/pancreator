import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { stageWriteRoots } from '../../src/lib/engine/executors.js'
import {
  writeDelegationLiveLaunch,
  initializeDelegationCustody,
  delegationCustodyDirectory,
  delegationCustodyPreparationPath,
  delegationLivePaths,
  type DelegationLiveRecord,
} from '../../src/lib/executors/delegation-live.js'
import { resolveWriteSandbox } from '../../src/lib/executors/write-sandbox.js'
import { custodyAuthorityRoot } from '../../src/lib/executors/scope-custody.js'
import { runCopilotCli } from '../../src/lib/executors/copilot-cli.js'
import { gitWorkspaceSnapshot } from '../../src/lib/git.js'
import { fileExists, writeJsonAtomic } from '../../src/lib/io.js'
import { resolveRunLayout } from '../../src/lib/run-layout.js'
import type { Invocation, StageDefinition } from '../../src/lib/types.js'
import { evaluateDeterministicCriteria } from '../../src/lib/validation.js'
import { createFixture, fixtureGit } from '../fixture-template.js'
import { checkpoint } from './delivery-helpers.js'

function setup(
  slug = 'verify',
  mode: 'sandbox-exec' | 'none' = 'sandbox-exec',
  legacy = false,
) {
  const {
    root,
    state,
    invocation: prepared,
  } = checkpoint('delivery@implement-prepared')
  const workspace = createFixture()
  const stage: StageDefinition = {
    slug,
    title: slug,
    persona: slug === 'ship' ? 'release-steward' : 'reviewer',
    workspace_policy: slug === 'ship' ? 'release_metadata_only' : 'read_only',
    gate: 'next_stage',
    context: { request: 'omit' },
    criteria: [],
    transitions: { success: 'succeeded', failure: 'failed', blocked: 'paused' },
  }
  assert.ok(prepared)
  const layout = resolveRunLayout(root, state.run_id)
  const invocation: Invocation = {
    ...prepared,
    invocation_id: 'inv-1',
    attempt: 1,
    stage: {
      ...prepared.stage,
      slug,
      persona: stage.persona,
      workspace_policy: stage.workspace_policy,
      persona_executor: 'copilot',
    },
  }
  const pointer = {
    id: 'inv-1',
    json_path: layout.invocation('inv-1', '.json').relative,
    markdown_path: '',
    output_path: '',
  }
  writeJsonAtomic(path.join(root, pointer.json_path), invocation)
  state.workspace_root = workspace
  state.current_invocation = pointer
  if (!legacy) {
    initializeDelegationCustody(root, invocation)
  }
  const record: DelegationLiveRecord = {
    schema_version: 1,
    run_id: state.run_id,
    invocation_id: 'inv-1',
    role: 'stage',
    attempt: 1,
    launch_id: 'launch-1',
    executor: 'copilot',
    launched_at: new Date().toISOString(),
    heartbeat_at: new Date().toISOString(),
    relay_pid: 101,
    relay_start_identity: 'relay-start',
    child_pid: 102,
    child_start_identity: 'child-start',
    sequence: 0,
    stream_sequences: { stdout: 0, stderr: 0 },
    truncated: false,
    ended_at: new Date().toISOString(),
    exit_code: 0,
    write_boundary: {
      mode,
      reason: mode === 'none' ? 'Fixture enforcement unavailable.' : '',
      write_roots: stageWriteRoots(root, workspace, stage),
      effective_write_roots: stageWriteRoots(root, workspace, stage),
    },
    write_observations: [],
  }
  const before = gitWorkspaceSnapshot(workspace)
  const harnessBefore = gitWorkspaceSnapshot(root)
  return {
    root,
    workspace,
    state,
    stage,
    record,
    invocation,
    saveInvocation() {
      writeJsonAtomic(path.join(root, pointer.json_path), invocation)
      initializeDelegationCustody(root, invocation)
    },
    evaluate(publish = true) {
      if (!legacy && publish) {
        writeDelegationLiveLaunch(root, record)
      }
      const result = evaluateDeterministicCriteria(
        root,
        layout.agent.absolute,
        state,
        stage,
        before,
        workspace,
        {},
        slug,
        undefined,
        undefined,
        null,
        gitWorkspaceSnapshot(workspace, { commitBase: before.head }),
        {},
        harnessBefore,
      ).results.find((item) => item.id === 'scope.no_unapproved_changes')
      assert.ok(result)
      return { ...result, explanation: result.explanation ?? '' }
    },
  }
}

for (const slug of ['verify', 'ship']) {
  test(`${slug} pre-inventory invocation preserves clean scope and rejects controller or workspace changes`, () => {
    const fixture = setup(slug, 'none', true)
    const directory = delegationCustodyDirectory(
      fixture.root,
      fixture.invocation,
    )
    assert.equal(fileExists(directory), false)
    assert.equal(
      fileExists(
        delegationCustodyPreparationPath(fixture.root, fixture.invocation),
      ),
      false,
    )
    const clean = fixture.evaluate()
    assert.equal(clean.passed, true, clean.explanation)
    assert.match(
      clean.explanation,
      /Legacy invocation has no protected launch inventory/u,
    )
    const controllerPath = path.join(fixture.root, 'src/base.ts')
    const controllerBefore = readFileSync(controllerPath)
    writeFileSync(controllerPath, 'possibly own\n')
    const controllerChange = fixture.evaluate()
    assert.equal(controllerChange.passed, false, controllerChange.explanation)
    assert.match(controllerChange.explanation, /Unverified attribution/u)
    writeFileSync(controllerPath, controllerBefore)
    writeFileSync(
      path.join(fixture.workspace, 'src/base.ts'),
      'own workspace\n',
    )
    const workspaceChange = fixture.evaluate()
    assert.equal(workspaceChange.passed, false, workspaceChange.explanation)
    assert.match(workspaceChange.explanation, /src\/base\.ts/u)
  })
}

for (const corruption of [
  'missing-invocation',
  'missing-directory',
  'tampered-invocation',
  'tampered-preparation',
  'missing-delivery',
]) {
  test(`current protected preparation rejects ${corruption} even with unchanged source`, () => {
    const fixture = setup()
    const directory = delegationCustodyDirectory(
      fixture.root,
      fixture.invocation,
    )
    if (corruption === 'missing-directory') {
      rmSync(directory, { recursive: true })
    } else if (corruption === 'missing-invocation') {
      unlinkSync(path.join(directory, 'invocation.json'))
    } else if (corruption === 'tampered-preparation') {
      writeJsonAtomic(
        delegationCustodyPreparationPath(fixture.root, fixture.invocation),
        {},
      )
    } else if (corruption === 'missing-delivery') {
      assert.ok(fixture.state.current_invocation)
      unlinkSync(
        path.join(fixture.root, fixture.state.current_invocation.json_path),
      )
    } else {
      writeJsonAtomic(path.join(directory, 'invocation.json'), {})
    }
    const result = fixture.evaluate(false)
    assert.equal(result.passed, false, result.explanation)
    assert.match(
      result.explanation,
      /Invalid custody evidence|differs from protected scope authority/u,
    )
  })
}

test('an older protected inventory remains authoritative without a preparation receipt', () => {
  const fixture = setup()
  unlinkSync(delegationCustodyPreparationPath(fixture.root, fixture.invocation))
  const intact = fixture.evaluate()
  assert.equal(intact.passed, true, intact.explanation)
  unlinkSync(
    path.join(
      delegationCustodyDirectory(fixture.root, fixture.invocation),
      'invocation.json',
    ),
  )
  const damaged = fixture.evaluate(false)
  assert.equal(damaged.passed, false, damaged.explanation)
  assert.match(damaged.explanation, /Invalid custody evidence/u)
})

test('public launch observations cannot turn missing authority into a clean legacy pass', () => {
  const fixture = setup('verify', 'none', true)
  fixture.record.write_observations?.push({
    path: path.join(fixture.root, 'src/base.ts'),
    outcome: 'denied',
    evidence: 'untrusted legacy write attempt',
  })
  writeJsonAtomic(
    delegationLivePaths(fixture.root, fixture.record).record,
    fixture.record,
  )
  const result = fixture.evaluate()
  assert.equal(result.passed, false, result.explanation)
  assert.match(result.explanation, /Invalid custody evidence/u)
})

for (const slug of ['verify', 'ship']) {
  for (const committed of [false, true]) {
    test(`${slug} retains foreign controller ${committed ? 'commits' : 'dirty edits'} as observations with proven custody`, () => {
      const fixture = setup(slug)
      writeFileSync(path.join(fixture.root, 'src/base.ts'), 'foreign actor\n')
      writeFileSync(path.join(fixture.root, 'foreign.txt'), 'untracked actor\n')
      if (committed) {
        fixtureGit(['add', '-A'], { cwd: fixture.root, encoding: 'utf8' })
        fixtureGit(['commit', '-qm', 'foreign controller change'], {
          cwd: fixture.root,
          encoding: 'utf8',
        })
      }
      const result = fixture.evaluate()
      assert.equal(result.passed, true, result.explanation)
      assert.match(result.explanation, /External controller observations/u)
      assert.match(result.explanation, /src\/base\.ts/u)
      assert.match(result.explanation, /foreign\.txt/u)
    })
  }
}

for (const outcome of ['written', 'denied'] as const) {
  test(`a simultaneous own ${outcome} outside roots defeats foreign evidence for the same path`, () => {
    const fixture = setup()
    const target = path.join(fixture.root, 'src/base.ts')
    writeFileSync(target, 'foreign actor and own actor\n')
    fixture.record.write_observations?.push({
      path: target,
      outcome,
      evidence: 'tool event 2, child 102, child-start',
    })
    const result = fixture.evaluate()
    assert.equal(result.passed, false)
    assert.match(result.explanation, /Own unauthorized/u)
    assert.match(result.explanation, new RegExp(outcome, 'u'))
  })
}

test('unavailable enforcement reports the gap and remedy rather than an own write or clean pass', () => {
  const fixture = setup('verify', 'none')
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Unverified attribution/u)
  assert.match(result.explanation, /Fixture enforcement unavailable/u)
  assert.match(result.explanation, /Collect complete launch identities/u)
  assert.doesNotMatch(result.explanation, /Own unauthorized/u)
})

test('a denied attempt against protected custody remains unauthorized inside the runtime grant', () => {
  const fixture = setup()
  fixture.record.write_observations?.push({
    path: path.join(custodyAuthorityRoot(fixture.root), 'forged.json'),
    outcome: 'denied',
    evidence: 'protected custody denial',
  })
  const result = fixture.evaluate()
  assert.equal(result.passed, false, result.explanation)
  assert.match(result.explanation, /protected custody denial/u)
})

test('a wrong attempt cannot authorize even an unchanged controller', () => {
  const fixture = setup()
  fixture.record.attempt = 2
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Wrong run, role, or attempt/u)
})

test('altering delivered scope authority cannot authorize controller observations', () => {
  const fixture = setup()
  fixture.invocation.stage.workspace_policy = 'source_allowed'
  assert.ok(fixture.state.current_invocation)
  writeJsonAtomic(
    path.join(fixture.root, fixture.state.current_invocation.json_path),
    fixture.invocation,
  )
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false, result.explanation)
  assert.match(result.explanation, /differs from protected scope authority/u)
})

test('a legacy invocation without prepared authority cannot gain exclusion from a later launch', () => {
  const fixture = setup()
  unlinkSync(
    path.join(
      custodyAuthorityRoot(fixture.root),
      fixture.record.run_id,
      fixture.record.invocation_id,
      'invocation.json',
    ),
  )
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false, result.explanation)
  assert.match(result.explanation, /no protected launch inventory/u)
})

for (const persona of ['unauthorized-persona', 'remediator-severe']) {
  test(`an unselected persona '${persona}' cannot authorize even an unchanged controller`, () => {
    const fixture = setup()
    fixture.stage.persona_by_verdict = {
      source_stage: 'verify',
      path: 'verify.verdict',
      map: { fail_severe: 'remediator-severe' },
    }
    fixture.invocation.stage.persona = persona
    fixture.saveInvocation()

    const result = fixture.evaluate()

    assert.equal(result.passed, false)
    assert.match(
      result.explanation,
      /Invocation custody does not match the active stage/u,
    )
  })
}

for (const persona of ['remediator-severe', 'reviewer']) {
  test(`a severe verdict ${persona === 'remediator-severe' ? 'authorizes its selected persona' : 'rejects the ordinary persona'}`, () => {
    const fixture = setup()
    const outputPath = 'runtime/verify-persona-source.json'
    fixture.stage.persona_by_verdict = {
      source_stage: 'verify',
      path: 'verify.verdict',
      map: { fail_severe: 'remediator-severe' },
    }
    writeJsonAtomic(path.join(fixture.root, outputPath), {
      data: { verify: { verdict: 'fail_severe' } },
    })
    fixture.state.stage_history.push({
      stage: 'verify',
      attempt: 1,
      invocation_id: 'prior-verify',
      output_path: outputPath,
      outcome: 'failure',
      submitted_at: new Date().toISOString(),
      workspace_fingerprint: '',
      validation_errors: [],
      deterministic: [],
    })
    fixture.invocation.stage.persona = persona
    fixture.saveInvocation()

    const result = fixture.evaluate()

    assert.equal(
      result.passed,
      persona === 'remediator-severe',
      result.explanation,
    )
    if (persona !== 'remediator-severe') {
      assert.match(
        result.explanation,
        /Invocation custody does not match the active stage/u,
      )
    }
  })
}

test('missing process start identity cannot exclude controller edits', () => {
  const fixture = setup()
  fixture.record.child_start_identity = null
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Incomplete process custody/u)
})

test('every resumed launch must exclude a controller path', () => {
  const fixture = setup()
  writeDelegationLiveLaunch(fixture.root, {
    ...fixture.record,
    launch_id: 'earlier-launch',
    write_boundary: {
      mode: 'none',
      reason: 'Earlier process had no enforcement.',
      write_roots: [],
      effective_write_roots: [],
    },
  })
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Earlier process had no enforcement/u)
})

test('evidence worker custody is required before controller observations are foreign', () => {
  const fixture = setup()
  fixture.invocation.evidence_workers = [
    {
      persona: 'reviewer',
      role: 'review',
      scope: 'review',
      agent: 'pan-reviewer',
      model: 'copilot:test-model',
      brief_path: '',
      evidence_path: '',
    },
  ]
  fixture.saveInvocation()
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'unknown actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /role 'review'/u)
})

test('own evidence worker attempts defeat an otherwise enforced stage boundary', () => {
  const fixture = setup()
  fixture.invocation.evidence_workers = [
    {
      persona: 'reviewer',
      role: 'review',
      scope: 'review',
      agent: 'pan-reviewer',
      model: 'copilot:test-model',
      brief_path: '',
      evidence_path: '',
    },
  ]
  fixture.saveInvocation()
  writeDelegationLiveLaunch(fixture.root, {
    ...fixture.record,
    role: 'review',
    write_observations: [
      {
        path: path.join(fixture.root, 'src/base.ts'),
        outcome: 'denied',
        evidence: 'review tool event 2',
      },
    ],
  })
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /review tool event 2/u)
})

test('symlink escape in an own write cannot pass scope', () => {
  const fixture = setup()
  const runtime = path.join(fixture.root, 'runtime')
  symlinkSync(fixture.workspace, path.join(runtime, 'escape'))
  fixture.record.write_observations?.push({
    path: path.join(runtime, 'escape', 'absent.ts'),
    outcome: 'denied',
    evidence: 'symlink escape event',
  })
  assert.equal(fixture.evaluate().passed, false)
})

test('foreign evidence leaves isolated workspace mutation detection intact', () => {
  const fixture = setup()
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'foreign actor\n')
  writeFileSync(path.join(fixture.workspace, 'src/base.ts'), 'own actor\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Workspace contamination/u)
})

test('release metadata in the isolated workspace remains permitted while source edits fail', () => {
  const permitted = setup('ship')
  writeFileSync(path.join(permitted.workspace, 'VERSION'), '9.9.9\n')
  assert.equal(permitted.evaluate().passed, true)
  const forbidden = setup('ship')
  writeFileSync(path.join(forbidden.workspace, 'src/base.ts'), 'own source\n')
  assert.equal(forbidden.evaluate().passed, false)
})

test('sandbox state exceptions cannot masquerade as an excluded controller path', () => {
  const fixture = setup()
  fixture.record.write_boundary?.effective_write_roots.push(fixture.root)
  writeFileSync(path.join(fixture.root, 'src/base.ts'), 'possibly own\n')
  const result = fixture.evaluate()
  assert.equal(result.passed, false)
  assert.match(result.explanation, /Unverified attribution/u)
})

for (const tampering of [
  'forged-boundary',
  'omitted-launch',
  'erased-denial',
  'malformed-denial',
]) {
  test(`a real child cannot establish foreign attribution with ${tampering}`, () => {
    const fixture = setup()
    const target = path.join(fixture.root, 'src/base.ts')
    const prior: DelegationLiveRecord = {
      ...fixture.record,
      launch_id: 'prior-launch',
      write_boundary:
        tampering === 'omitted-launch'
          ? {
              mode: 'none',
              reason: 'Earlier launch was unenforced.',
              write_roots: [],
              effective_write_roots: [],
            }
          : fixture.record.write_boundary,
      write_observations: ['erased-denial', 'malformed-denial'].includes(
        tampering,
      )
        ? [{ path: target, outcome: 'denied', evidence: 'prior denial' }]
        : [],
    }
    writeDelegationLiveLaunch(fixture.root, prior)
    const identity = {
      ...fixture.record,
      launch_id: 'tampering-launch',
      write_boundary: {
        mode: 'none' as const,
        reason: 'Task write enforcement disabled for this child.',
        write_roots: fixture.record.write_boundary?.write_roots ?? [],
        effective_write_roots:
          fixture.record.write_boundary?.effective_write_roots ?? [],
      },
    }
    writeDelegationLiveLaunch(fixture.root, identity)
    const livePath = delegationLivePaths(fixture.root, identity).record
    const priorPath = delegationLivePaths(fixture.root, prior).record
    const binary = path.join(fixture.root, 'tampering-copilot')
    const script = `${binary}.mjs`
    writeFileSync(
      script,
      `
import fs from 'node:fs'
fs.writeFileSync(${JSON.stringify(target)}, 'own unenforced write\\n')
const current = JSON.parse(fs.readFileSync(${JSON.stringify(livePath)}, 'utf8'))
current.write_boundary = ${JSON.stringify(fixture.record.write_boundary)}
current.write_observations = []
current.ended_at = new Date().toISOString()
current.exit_code = 0
fs.writeFileSync(${JSON.stringify(livePath)}, JSON.stringify(current))
if (${JSON.stringify(tampering)} === 'omitted-launch') {
  fs.unlinkSync(${JSON.stringify(priorPath)})
} else if (${JSON.stringify(tampering)} === 'erased-denial') {
  const prior = JSON.parse(fs.readFileSync(${JSON.stringify(priorPath)}, 'utf8'))
  prior.write_observations = []
  fs.writeFileSync(${JSON.stringify(priorPath)}, JSON.stringify(prior))
} else if (${JSON.stringify(tampering)} === 'malformed-denial') {
  fs.writeFileSync(${JSON.stringify(priorPath)}, 'invalid JSON')
}
console.log(JSON.stringify({type:'result',exitCode:0}))
`,
    )
    writeFileSync(
      binary,
      `#!/bin/bash\nexec "${process.execPath}" "${script}" "$@"\n`,
    )
    chmodSync(binary, 0o755)
    const previousSandbox = process.env.PANCREATOR_WRITE_SANDBOX
    process.env.PANCREATOR_WRITE_SANDBOX = '0'
    try {
      const sandbox = resolveWriteSandbox(
        stageWriteRoots(fixture.root, fixture.workspace, fixture.stage),
        [custodyAuthorityRoot(fixture.root)],
      )
      const launch = sandbox.wrap(binary, [])
      const child = spawnSync(launch.binary, launch.argv, {
        cwd: fixture.workspace,
        encoding: 'utf8',
        timeout: 20_000,
      })
      launch.cleanup()
      assert.equal(child.status, 0, child.stderr)
      assert.equal(readFileSync(target, 'utf8'), 'own unenforced write\n')
      const result = fixture.evaluate()
      assert.equal(result.passed, false, result.explanation)
      assert.doesNotMatch(
        result.explanation,
        /External controller observations/u,
      )
      if (['erased-denial', 'malformed-denial'].includes(tampering)) {
        assert.match(result.explanation, /prior denial/u)
      }
    } finally {
      if (previousSandbox === undefined) {
        delete process.env.PANCREATOR_WRITE_SANDBOX
      } else {
        process.env.PANCREATOR_WRITE_SANDBOX = previousSandbox
      }
    }
  })
}

for (const disabled of [false, true]) {
  test(`controller custody resists direct child replacement and ancestor renames with task enforcement ${disabled ? 'disabled' : 'enabled'}`, () => {
    const fixture = setup()
    const record = { ...fixture.record, launch_id: 'protection-launch' }
    writeDelegationLiveLaunch(fixture.root, record)
    const authority = custodyAuthorityRoot(fixture.root)
    const protectedRecord = path.join(
      authority,
      fixture.record.run_id,
      fixture.record.invocation_id,
      path.basename(delegationLivePaths(fixture.root, record).record),
    )
    const script = path.join(fixture.root, 'authority-attacker.mjs')
    const alias = path.join(fixture.root, 'runtime/authority-alias')
    symlinkSync(authority, alias)
    writeFileSync(
      script,
      `
import fs from 'node:fs'
const outcomes = []
const attempt = (name, action) => {
  try { action(); outcomes.push({name, denied:false}) }
  catch (error) { outcomes.push({name, denied:['EPERM','EACCES'].includes(error.code), code:error.code}) }
}
fs.writeFileSync(${JSON.stringify(delegationLivePaths(fixture.root, record).record)}, '{}')
attempt('replace', () => fs.writeFileSync(${JSON.stringify(protectedRecord)}, '{}'))
attempt('delete', () => fs.unlinkSync(${JSON.stringify(protectedRecord)}))
attempt('symlink', () => fs.writeFileSync(${JSON.stringify(path.join(alias, fixture.record.run_id, fixture.record.invocation_id, path.basename(protectedRecord)))}, '{}'))
attempt('hardlink', () => {
  const alias = ${JSON.stringify(path.join(fixture.workspace, 'authority-hardlink'))}
  fs.linkSync(${JSON.stringify(protectedRecord)}, alias)
  fs.writeFileSync(alias, '{}')
})
attempt('directory', () => fs.renameSync(${JSON.stringify(authority)}, ${JSON.stringify(`${authority}-moved`)}))
attempt('ancestor', () => fs.renameSync(${JSON.stringify(path.dirname(authority))}, ${JSON.stringify(`${path.dirname(authority)}-moved`)}))
console.log(JSON.stringify(outcomes))
`,
    )
    const previous = process.env.PANCREATOR_WRITE_SANDBOX
    if (disabled) process.env.PANCREATOR_WRITE_SANDBOX = '0'
    else delete process.env.PANCREATOR_WRITE_SANDBOX
    try {
      const sandbox = resolveWriteSandbox(
        stageWriteRoots(fixture.root, fixture.workspace, fixture.stage),
        [authority],
      )
      const launch = sandbox.wrap(process.execPath, [script])
      try {
        const child = spawnSync(launch.binary, launch.argv, {
          cwd: fixture.workspace,
          encoding: 'utf8',
          timeout: 20_000,
        })
        assert.equal(child.status, 0, child.stderr)
        const outcomes = JSON.parse(child.stdout) as Array<{
          name: string
          denied: boolean
          code?: string
        }>
        assert.equal(outcomes.length, 6)
        if (process.platform === 'darwin') {
          assert.ok(
            outcomes.every(({ denied }) => denied),
            child.stdout,
          )
          assert.deepEqual(
            JSON.parse(readFileSync(protectedRecord, 'utf8')),
            record,
          )
        } else {
          assert.equal(sandbox.mode, 'none')
          assert.ok(sandbox.reason)
        }
        const evaluated = fixture.evaluate()
        assert.equal(evaluated.passed, false, evaluated.explanation)
      } finally {
        launch.cleanup()
      }
    } finally {
      if (previous === undefined) delete process.env.PANCREATOR_WRITE_SANDBOX
      else process.env.PANCREATOR_WRITE_SANDBOX = previous
    }
  })

  test(`the actual Copilot launch records ${disabled ? 'unavailable enforcement and completed writes' : 'enforcement and denied writes'} in live and final evidence`, () => {
    const fixture = setup()
    const binary = path.join(fixture.root, 'copilot-fixture')
    const script = `${binary}.mjs`
    const target = path.join(fixture.root, 'src/base.ts')
    writeFileSync(
      script,
      `
import fs from 'node:fs'
const emit = value => console.log(JSON.stringify(value))
const session = process.argv.find(arg => arg.startsWith('--session-id='))?.slice('--session-id='.length)
for await (const chunk of process.stdin) {}
emit({type:'tool.execution_start',data:{toolName:'create',toolCallId:'write-1',arguments:{path:${JSON.stringify(target)}}}})
try {
  fs.writeFileSync(${JSON.stringify(target)}, 'own actor\\n')
  emit({type:'tool.execution_complete',data:{toolCallId:'write-1',success:true}})
} catch (error) {
  emit({type:'tool.execution_complete',data:{toolCallId:'write-1',success:false,error:error.message}})
}
emit({type:'result',sessionId:session,exitCode:0})
`,
    )
    writeFileSync(
      binary,
      `#!/bin/bash\nexec "${process.execPath}" "${script}" "$@"\n`,
    )
    chmodSync(binary, 0o755)
    const previousBinary = process.env.PANCREATOR_COPILOT_BIN
    const previousSandbox = process.env.PANCREATOR_WRITE_SANDBOX
    process.env.PANCREATOR_COPILOT_BIN = binary
    if (disabled) {
      process.env.PANCREATOR_WRITE_SANDBOX = '0'
    } else {
      delete process.env.PANCREATOR_WRITE_SANDBOX
    }
    try {
      const result = runCopilotCli({
        prompt: 'fixture write',
        cwd: fixture.workspace,
        model: 'test-model',
        availableTools: ['create'],
        environment: {},
        addDirs: [fixture.root],
        writeRoots: stageWriteRoots(
          fixture.root,
          fixture.workspace,
          fixture.stage,
        ),
        live: {
          root: fixture.root,
          identity: {
            run_id: fixture.record.run_id,
            invocation_id: fixture.record.invocation_id,
            role: 'stage',
            attempt: 1,
            launch_id: 'actual-launch',
          },
        },
      })
      assert.equal(result.ok, true, result.error ?? '')
      assert.ok(result.write_boundary)
      assert.ok(result.custody_records?.length)
      assert.deepEqual(
        result.write_boundary.write_roots,
        stageWriteRoots(fixture.root, fixture.workspace, fixture.stage),
      )
      if (disabled) {
        assert.equal(result.write_boundary.mode, 'none')
        assert.match(result.write_boundary.reason, /Disabled/u)
      }
      const evaluated = fixture.evaluate()
      assert.equal(evaluated.passed, false)
      assert.match(evaluated.explanation, /Own unauthorized/u)
      assert.match(
        evaluated.explanation,
        result.write_boundary.mode === 'sandbox-exec' ? /denied/u : /written/u,
      )
    } finally {
      if (previousBinary === undefined)
        delete process.env.PANCREATOR_COPILOT_BIN
      else process.env.PANCREATOR_COPILOT_BIN = previousBinary
      if (previousSandbox === undefined)
        delete process.env.PANCREATOR_WRITE_SANDBOX
      else process.env.PANCREATOR_WRITE_SANDBOX = previousSandbox
    }
  })
}

test('the real sandbox enforces its reported boundary or explicitly reports unavailable enforcement', () => {
  const root = createFixture()
  const allowed = path.join(root, 'runtime')
  mkdirSync(allowed, { recursive: true })
  const sandbox = resolveWriteSandbox([allowed])
  if (sandbox.mode === 'none') {
    assert.ok(sandbox.reason)
    return
  }
  const launch = sandbox.wrap(process.execPath, [
    '-e',
    `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(path.join(allowed, 'allowed.txt'))}, 'ok'); try { fs.writeFileSync(${JSON.stringify(path.join(root, 'forbidden.txt'))}, 'bad'); process.exit(2) } catch (error) { if (!['EPERM', 'EACCES'].includes(error.code)) throw error }`,
  ])
  try {
    const result = spawnSync(launch.binary, launch.argv, { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
  } finally {
    launch.cleanup()
  }
})
