import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { runVerificationExecutionProcess } from '../../src/lib/engine/verification-execution-process.js'
import {
  collectVerificationExecutionEvidence,
  resolveVerificationExecutionOperations,
  verificationExecutionGaps,
} from '../../src/lib/engine/verification-execution.js'
import { writeSandboxProfile } from '../../src/lib/executors/write-sandbox.js'
import { isRecord, readJson, writeJsonAtomic } from '../../src/lib/io.js'
import { sharedFixture } from '../fixture-template.js'
import { prepared, enforced } from './verification-execution-fixtures.js'
import { operation } from './verification-execution-helpers.js'

test('successful parents cannot leave detached descendants beyond the operation deadline', async () => {
  const sentinel = 'runtime/verification-execution/detached/late.txt'
  const code = [
    'const {spawn}=require("node:child_process");',
    'try {',
    `const child=spawn(process.execPath,["-e",${JSON.stringify(`setTimeout(()=>require("node:fs").writeFileSync(${JSON.stringify(sentinel)},"escaped"),600)`)}],{detached:true,stdio:"ignore"});`,
    'child.on("error",e=>console.log(e.code));',
    'child.unref(); console.log(child.pid ?? "denied");',
    '} catch(e) { if(e.code !== "EPERM") throw e; console.log(e.code); }',
  ].join('')
  const { root, state, invocation } = prepared([
    operation('detached', code, { timeout_ms: 400 }),
  ])
  const { manifest } = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
  )
  const record = manifest.records[0]

  // The attempted child is finite even against the regressed collector.
  await delay(1200)
  assert.equal(
    existsSync(path.join(root, sentinel)),
    false,
    'detached child outlived the deadline',
  )
  if (enforced(root)) {
    assert.equal(record.exit_code, 0, JSON.stringify(record))
    assert.match(record.stdout, /denied|EPERM/u)
    assert.equal(record.enforcement.processes, 'single-process')
  } else {
    assert.equal(record.status, 'gap')
  }
})

test('legacy records without process containment are nonpassing and recollected with history', () => {
  const { root, state, invocation } = prepared([
    operation('legacy-processes', "console.log('direct operation')"),
  ])
  const original = collectVerificationExecutionEvidence(root, state, invocation)

  if (!enforced(root)) {
    assert.equal(original.manifest.records[0].status, 'gap')
    return
  }

  assert.equal(original.manifest.records[0].status, 'collected')
  delete original.manifest.records[0].enforcement.processes
  writeJsonAtomic(
    path.join(root, invocation.verification_execution!.manifest_path),
    original.manifest,
  )
  assert.ok(verificationExecutionGaps(root, invocation).length > 0)

  const refreshed = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
  )
  assert.equal(
    refreshed.manifest.records[0].enforcement.processes,
    'single-process',
  )
  assert.deepEqual(refreshed.manifest.history, [original.manifest.records[0]])
  assert.deepEqual(verificationExecutionGaps(root, invocation), [])
})

test('the process supervisor bounds overflow and reports actual spawn failures and signals', () => {
  const root = sharedFixture()
  const overflow = runVerificationExecutionProcess(
    {
      binary: process.execPath,
      argv: [
        '-e',
        "process.stdout.write('x'.repeat(8192));setInterval(()=>{},1000)",
      ],
      timeout_ms: 3000,
      max_bytes: 1024,
    },
    root,
    process.env,
  )
  assert.match(overflow.error ?? '', /output bound/u)
  assert.equal(Buffer.byteLength(overflow.stdout), 1024)
  assert.equal(overflow.signal, 'SIGKILL')
  const missing = runVerificationExecutionProcess(
    {
      binary: path.join(root, 'does-not-exist'),
      argv: [],
      timeout_ms: 3000,
      max_bytes: 1024,
    },
    root,
    process.env,
  )
  assert.match(missing.error ?? '', /ENOENT/u)
  assert.notEqual(missing.status, 0)
})

test('unsafe write grants and symlink escapes are gaps without launching a process', () => {
  const { root, state, invocation } = prepared([
    operation('broad', "console.log('must not run')", { write_roots: ['.'] }),
    operation('link', "console.log('must not run')", { required: false }),
  ])
  const broad = collectVerificationExecutionEvidence(root, state, invocation)
  assert.equal(broad.manifest.records[0].status, 'gap')
  assert.equal(broad.manifest.records[0].stdout, '')
  const scratch = path.join(root, 'runtime/verification-execution')
  mkdirSync(scratch, { recursive: true })
  symlinkSync(root, path.join(scratch, 'link'))
  const linked = collectVerificationExecutionEvidence(root, state, invocation, [
    { id: 'link', reason: 'path escape' },
  ])
  assert.equal(linked.collected, 0)
  assert.match(
    linked.manifest.records.find((record) => record.operation_id === 'link')
      ?.error ?? '',
    /Symlink/u,
  )
  assert.equal(writeSandboxProfile([scratch], true).includes('.cursor'), false)
})

test('nonzero exits, timeouts, absent files, and changed authority cannot become passing evidence', () => {
  const { root, state, invocation } = prepared([
    operation('failure', "console.error('actual failure');process.exit(17)"),
    operation('timeout', 'setInterval(()=>{},1000)', { timeout_ms: 50 }),
    operation('missing', "console.log('no file')", {
      evidence_paths: ['runtime/verification-execution/missing/absent.txt'],
    }),
  ])
  const { manifest } = collectVerificationExecutionEvidence(
    root,
    state,
    invocation,
  )
  if (enforced(root)) {
    assert.equal(manifest.records[0].exit_code, 17)
    assert.equal(manifest.records[0].status, 'failed')
    assert.match(manifest.records[0].stderr, /actual failure/u)
    assert.equal(manifest.records[1].timed_out, true)
    assert.equal(manifest.records[1].signal, 'SIGKILL')
    assert.equal(manifest.records[2].status, 'gap')
  }
  assert.ok(verificationExecutionGaps(root, invocation).length >= 3)
  const contract = invocation.verification_execution!
  const authority = path.join(root, contract.sources[0].path)
  writeFileSync(authority, `${readFileSync(authority, 'utf8')} `)
  assert.ok(
    verificationExecutionGaps(root, invocation).some((gap) =>
      /authority source changed/u.test(gap),
    ),
  )
  const resolved = resolveVerificationExecutionOperations(
    root,
    state,
    invocation,
  )
  assert.equal(resolved.operations.length, 3)
})

test('wrong invocation, missing manifests, malformed records, and profile substitutions fail closed', () => {
  const { root, invocation } = prepared([
    operation('identity', "console.log('observation')"),
  ])
  const manifestPath = invocation.verification_execution!.manifest_path
  const manifest = readJson(path.join(root, manifestPath))
  assert.ok(isRecord(manifest) && Array.isArray(manifest.records))
  assert.ok(isRecord(manifest.records[0]))
  for (const record of [
    null,
    { ...manifest.records[0], attempt: invocation.attempt + 1 },
    { ...manifest.records[0], argv: ['forged-command'] },
    {
      ...manifest.records[0],
      enforcement: { mode: 'none', reason: 'unenforced' },
    },
  ]) {
    writeJsonAtomic(path.join(root, manifestPath), {
      ...manifest,
      records: record === null ? [] : [record],
    })
    assert.ok(
      verificationExecutionGaps(root, invocation).some((gap) =>
        /Missing current successful observation/u.test(gap),
      ),
    )
  }
  writeJsonAtomic(path.join(root, manifestPath), {
    ...manifest,
    invocation_id: 'another-invocation',
  })
  assert.ok(
    verificationExecutionGaps(root, invocation).some((gap) =>
      /different source, invocation/u.test(gap),
    ),
  )
  writeJsonAtomic(path.join(root, manifestPath), {
    ...manifest,
    records: [null],
  })
  assert.throws(
    () => verificationExecutionGaps(root, invocation),
    /Invalid execution manifest/u,
  )
  invocation.verification_execution!.manifest_path += '.missing'
  assert.ok(
    verificationExecutionGaps(root, invocation).some((gap) =>
      /Missing execution manifest/u.test(gap),
    ),
  )
  invocation.verification_execution!.operations[0].operation.argv = [
    'pan',
    'repository-check',
    'fast',
  ]
  assert.deepEqual(verificationExecutionGaps(root, invocation), [
    'Invalid verification execution invocation authority.',
  ])
})
