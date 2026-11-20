import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getAgentEntry,
  readAgentActivity,
} from '../../src/lib/agent-index/activity.js'
import { handleSubagentStart } from '../../src/lib/agent-index/hooks.js'
import { newAgentEntry, promptDigest } from '../../src/lib/agent-index/store.js'
import {
  readTranscriptState,
  subagentTranscriptCandidates,
  transcriptLastTaskDigest,
  TRANSCRIPT_TAIL_BYTES,
} from '../../src/lib/agent-index/transcript.js'
import { createTestTempDirectory } from '../temp.js'

function fixtureAgent(parentTranscript: string, agentId = 'child-alias') {
  return {
    ...newAgentEntry(agentId, '2026-10-01T00:00:00.000Z'),
    parent_transcript_path: parentTranscript,
    aliases: ['alias-uuid'],
  }
}

test('a turn_ended transcript record is a completed stop without subagentStop', () => {
  const root = createTestTempDirectory('transcript-stop-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parent = path.join(root, 'parent.jsonl')
  writeFileSync(parent, '{}\n')

  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'canonical-child',
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: 'run 63278_Oct-01-0956_chunk-subage implement 99_implement-1_65919ef7',
    transcript_path: parent,
  })

  const childDir = path.join(path.dirname(parent), 'subagents')
  mkdirSync(childDir, { recursive: true })
  const childPath = path.join(childDir, 'canonical-child.jsonl')
  writeFileSync(childPath, '{"type":"turn_ended","status":"success"}\n', 'utf8')

  const now = Date.parse('2026-10-01T01:00:00.000Z')
  const activity = readAgentActivity(root, 'canonical-child', now, 60)

  assert.ok(activity)
  assert.equal(activity.stop?.status, 'completed')
  assert.equal(activity.stop?.source, 'transcript')
  assert.equal(activity.transcript?.turn_ended, true)

  // The same ended turn, read for an invocation created after it, is the
  // earlier attempt's stop rather than this one's.
  const registeredMs = Date.parse(
    getAgentEntry(root, 'canonical-child')?.registered_at ?? '',
  )
  const endedMs = Math.ceil(registeredMs / 1000) + 30
  utimesSync(childPath, endedMs, endedMs)

  assert.equal(
    readAgentActivity(root, 'canonical-child', now, 60, endedMs * 1000 + 1000)
      ?.stop,
    null,
  )
  assert.equal(
    readAgentActivity(root, 'canonical-child', now, 60, endedMs * 1000 - 1000)
      ?.stop?.status,
    'completed',
  )
})

test('a transcript mtime slightly before registration is still a current stop', () => {
  const root = createTestTempDirectory('transcript-mtime-lead-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parent = path.join(root, 'parent.jsonl')
  writeFileSync(parent, '{}\n')

  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'canonical-child',
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: 'run 63278_Oct-01-0956_chunk-subage implement 99_implement-1_65919ef7',
    transcript_path: parent,
  })

  const childDir = path.join(path.dirname(parent), 'subagents')
  mkdirSync(childDir, { recursive: true })
  const childPath = path.join(childDir, 'canonical-child.jsonl')
  writeFileSync(childPath, '{"type":"turn_ended","status":"success"}\n', 'utf8')

  const registeredMs = Date.parse(
    getAgentEntry(root, 'canonical-child')?.registered_at ?? '',
  )
  const slightlyBefore = (registeredMs - 500) / 1000
  utimesSync(childPath, slightlyBefore, slightlyBefore)

  const now = Date.parse('2026-10-01T01:00:00.000Z')
  const activity = readAgentActivity(root, 'canonical-child', now, 60)

  assert.ok(activity)
  assert.equal(activity.stop?.status, 'completed')
  assert.equal(activity.stop?.source, 'transcript')
})

test('transcript reader fails open on absent and partial tails', () => {
  const root = createTestTempDirectory('transcript-edge-')
  const parent = path.join(root, 'parent.jsonl')
  const agent = fixtureAgent(parent)
  const now = Date.now()

  assert.equal(readTranscriptState(agent, now), null)

  const childDir = path.join(path.dirname(parent), 'subagents')
  mkdirSync(childDir, { recursive: true })
  const childPath = path.join(childDir, 'child-alias.jsonl')
  writeFileSync(childPath, '{"type":"turn', 'utf8')

  const partial = readTranscriptState(agent, now)
  assert.ok(partial)
  assert.equal(partial.readable, false)
  assert.equal(partial.turn_ended, false)
})

test('transcript content never appears in activity stop metadata', () => {
  const secret = 'SECRET_MARKER_SHOULD_NOT_LEAK'
  const root = createTestTempDirectory('transcript-secret-')
  const parent = path.join(root, 'parent.jsonl')
  const childDir = path.join(path.dirname(parent), 'subagents')
  mkdirSync(childDir, { recursive: true })
  const childPath = path.join(childDir, 'child-alias.jsonl')
  writeFileSync(
    childPath,
    `{"type":"turn_ended","status":"success","note":"${secret}"}\n`,
    'utf8',
  )

  const agent = fixtureAgent(parent)
  const state = readTranscriptState(agent, Date.now())

  assert.ok(state)
  const serialized = JSON.stringify(state)
  assert.equal(serialized.includes(secret), false)
})

test('subagentStart keeps a valid parent transcript path for derivation', () => {
  const root = createTestTempDirectory('transcript-parent-path-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parentTranscript = path.join(root, 'parent-transcript.jsonl')
  writeFileSync(parentTranscript, '{}\n')

  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: 'canonical-child',
    conversation_id: 'parent-conv',
    parent_conversation_id: 'parent-conv',
    task: 'run 63278_Oct-01-0956_chunk-subage implement 99_implement-1_65919ef7',
    transcript_path: parentTranscript,
  })

  const agent = fixtureAgent(parentTranscript, 'canonical-child')
  agent.parent_transcript_path = parentTranscript
  const candidates = subagentTranscriptCandidates(agent)

  assert.ok(
    candidates.includes(
      path.join(
        path.dirname(parentTranscript),
        'subagents',
        'canonical-child.jsonl',
      ),
    ),
  )
})

test('TRANSCRIPT_TAIL_BYTES bounds the tail read window', () => {
  assert.equal(TRANSCRIPT_TAIL_BYTES, 4096)
})

test('the last user message, not an earlier parseable query, determines the resume digest', () => {
  const root = createTestTempDirectory('transcript-last-task-')
  const transcript = path.join(root, 'child.jsonl')
  const withQuery = (task: string) =>
    JSON.stringify({
      role: 'user',
      message: {
        content: [
          { type: 'text', text: `<user_query>\n${task}\n</user_query>` },
        ],
      },
    })

  writeFileSync(transcript, `${withQuery('first')}\n${withQuery('second')}\n`)
  assert.equal(transcriptLastTaskDigest(transcript), promptDigest('second'))

  writeFileSync(
    transcript,
    `${withQuery('first')}\n${JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'text', text: 'no tagged query' }] },
    })}\n{\"type\":\"turn_ended\",\"status\":\"success\"}\n`,
  )
  assert.equal(transcriptLastTaskDigest(transcript), null)
})

test('a repeated task cannot reuse a previous transcript stop inside the mtime tolerance', () => {
  const root = createTestTempDirectory('transcript-resume-same-task-')
  writeFileSync(path.join(root, 'package.json'), '{}')
  const parent = path.join(root, 'parent.jsonl')
  writeFileSync(parent, '{}\n')
  const task = 'Repeat this safe task'
  const start = () =>
    handleSubagentStart(root, {
      event: 'subagentStart',
      subagent_id: 'canonical-child',
      conversation_id: 'parent-conv',
      parent_conversation_id: 'parent-conv',
      task,
      transcript_path: parent,
    })
  start()
  const dir = path.join(root, 'subagents')
  mkdirSync(dir, { recursive: true })
  const child = path.join(dir, 'canonical-child.jsonl')
  const user = JSON.stringify({
    role: 'user',
    message: {
      content: [{ type: 'text', text: `<user_query>\n${task}\n</user_query>` }],
    },
  })
  writeFileSync(
    child,
    `${user}\n{\"type\":\"turn_ended\",\"status\":\"success\"}\n`,
  )
  const firstRegistration = Date.parse(
    getAgentEntry(root, 'canonical-child')?.registered_at ?? '',
  )
  while (Date.now() <= firstRegistration) {
    /* ensure an ordered second registration */
  }
  start()
  const secondRegistration = Date.parse(
    getAgentEntry(root, 'canonical-child')?.registered_at ?? '',
  )
  const oldStopMtime = (secondRegistration - 500) / 1000
  utimesSync(child, oldStopMtime, oldStopMtime)

  assert.equal(
    readAgentActivity(root, 'canonical-child', Date.now(), 60)?.stop,
    null,
  )

  // Once this new turn actually finishes, its newer transcript is a stop.
  writeFileSync(
    child,
    `${user}\n{\"type\":\"turn_ended\",\"status\":\"success\"}\n${user}\n{\"type\":\"turn_ended\",\"status\":\"success\"}\n`,
  )
  const newStopMtime = (secondRegistration + 500) / 1000
  utimesSync(child, newStopMtime, newStopMtime)
  assert.equal(
    readAgentActivity(root, 'canonical-child', Date.now(), 60)?.stop?.status,
    'completed',
  )
})
