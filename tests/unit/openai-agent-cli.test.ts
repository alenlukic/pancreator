import assert from 'node:assert/strict'
import test from 'node:test'

import { parseRequest } from '../../src/openai-agent-cli.js'

const BASE = {
  model: 'gpt-6-astra',
  prompt: 'Do the work.',
  invocation_id: '01_plan-1_abc',
  stage: 'plan',
  session_id: 'session-1',
  max_tool_rounds: 4,
  request_timeout_ms: 1_000,
  session_timeout_ms: 2_000,
  transcript_path: 'runtime/logs/transcript.jsonl',
  transcript_max_bytes: 1_024,
}

const POLICY = {
  workspaceDir: '/workspace',
  readRoots: ['/workspace'],
  writeRoots: ['/workspace/runtime'],
  allowedTools: ['read_file', 'search_files'],
  maxResultBytes: 4_096,
  shellTimeoutMs: 5_000,
}

function request(toolPolicy: unknown): string {
  return JSON.stringify({ ...BASE, tool_policy: toolPolicy })
}

// The tool grant is what withholds the shell from a stage whose write roots
// exclude the workspace. The request crosses a process boundary, where the
// TypeScript requirement is erased and only this check remains.
test('the agent request requires a non-empty allowedTools grant', () => {
  const { allowedTools, ...withoutTools } = POLICY

  assert.equal(allowedTools.length, 2)
  assert.throws(
    () => parseRequest(request(withoutTools)),
    /allowedTools MUST be a non-empty array/u,
  )
  assert.throws(
    () => parseRequest(request({ ...POLICY, allowedTools: [] })),
    /allowedTools MUST be a non-empty array/u,
  )
  assert.throws(
    () => parseRequest(request({ ...POLICY, allowedTools: 'run_shell' })),
    /allowedTools MUST be a non-empty array/u,
  )
})

test('the agent request requires the declared tool-policy roots', () => {
  assert.throws(
    () => parseRequest(request({ ...POLICY, writeRoots: undefined })),
    /workspaceDir, readRoots, and writeRoots/u,
  )
  assert.throws(
    () => parseRequest(request({ ...POLICY, readRoots: [1] })),
    /workspaceDir, readRoots, and writeRoots/u,
  )
})

test('a complete agent request parses into its declared shape', () => {
  const parsed = parseRequest(request(POLICY))

  assert.equal(parsed.model, BASE.model)
  assert.deepEqual(parsed.tool_policy.allowedTools, POLICY.allowedTools)
})
