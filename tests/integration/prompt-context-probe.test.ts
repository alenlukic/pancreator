import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  FLAT_CONTEXT_PROBE,
  HOOK_SPECIFIC_CONTEXT_PROBE,
  recordPromptContextProbe,
} from '../../src/lib/prompt-context-probe.js'
import { createFixture } from '../fixture-template.js'
import { createTestTempDirectory } from '../temp.js'

test('prompt context probe records the raw payload and returns distinct markers', () => {
  const root = createFixture()
  const payload = '{\n  "prompt": "retain whitespace"\n}\n'

  assert.deepEqual(recordPromptContextProbe(root, payload), {
    continue: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: HOOK_SPECIFIC_CONTEXT_PROBE,
    },
    additional_context: FLAT_CONTEXT_PROBE,
  })

  const line = readFileSync(
    path.join(root, 'runtime', 'logs', 'hooks', 'prompt-context.jsonl'),
    'utf8',
  ).trimEnd()

  assert.equal(JSON.parse(line), payload)
})

test('hook entry uses the built CLI and degrades permissively when it is missing', () => {
  const root = createTestTempDirectory('prompt-context-hook')
  const bin = path.join(root, 'bin')
  const hook = path.join(bin, 'pan-hook-governance-reminder')
  const source = path.join(process.cwd(), 'bin', 'pan-hook-governance-reminder')

  mkdirSync(bin, { recursive: true })
  copyFileSync(source, hook)
  chmodSync(hook, 0o755)

  const result = spawnSync(hook, {
    cwd: root,
    encoding: 'utf8',
    input: '{"prompt":"hello"}',
    timeout: 5000,
  })

  assert.equal(result.status, 0)
  assert.deepEqual(JSON.parse(result.stdout), { continue: true })

  const script = readFileSync(source, 'utf8')

  assert.match(script, /dist\/src\/cli\.js/u)
  assert.doesNotMatch(script, /bin\/pan(?:\s|["'])/u)
  assert.doesNotMatch(script, /\b(?:npm|tsc)\b/u)
})
