/**
 * A subagent's stop is read from its transcript, because `subagentStop` never
 * fires. The hooks key the child by its launch's tool call id, the parent
 * holds the child's conversation id, and only a tool call the child makes
 * links the two. A child that called no tool was never found
 * (`pan watch --agent` returned `unregistered`), and a resumed child started
 * a second, empty entry whose watch read the earlier turn's end as its stop.
 */
import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  getAgentEntry,
  readAgentIndex,
  readAgentStop,
} from '../../src/lib/agent-index/activity.js'
import {
  handlePreToolUse,
  handleSubagentStart,
} from '../../src/lib/agent-index/hooks.js'
import {
  lockPath,
  readIndex,
  withLock,
  writeIndex,
} from '../../src/lib/agent-index/store.js'
import { createTestTempDirectory } from '../temp.js'

const PARENT = 'parent-session'

function setup(prefix: string) {
  const root = createTestTempDirectory(prefix)
  const parentTranscript = path.join(
    root,
    'transcripts',
    PARENT,
    `${PARENT}.jsonl`,
  )

  writeFileSync(path.join(root, 'package.json'), '{}')
  mkdirSync(path.dirname(parentTranscript), { recursive: true })
  writeFileSync(parentTranscript, '{}\n')

  return {
    root,
    parentTranscript,
    subagents: path.join(path.dirname(parentTranscript), 'subagents'),
  }
}

function launch(
  root: string,
  parentTranscript: string,
  toolUseId: string,
  prompt: string,
  resume?: string,
): void {
  handlePreToolUse(root, {
    event: 'preToolUse',
    conversation_id: PARENT,
    tool_name: 'Task',
    tool_use_id: toolUseId,
    tool_input: {
      subagent_type: 'pan-reviewer',
      description: 'Review',
      prompt,
      run_in_background: true,
      ...(resume ? { resume } : {}),
    },
  })
  handleSubagentStart(root, {
    event: 'subagentStart',
    subagent_id: toolUseId,
    tool_call_id: toolUseId,
    conversation_id: PARENT,
    parent_conversation_id: PARENT,
    task: prompt,
    transcript_path: parentTranscript,
  })
}

function userRecord(prompt: string): string {
  return `${JSON.stringify({
    role: 'user',
    message: {
      content: [
        {
          type: 'text',
          text: `<timestamp>Friday</timestamp>\n<user_query>\n${prompt}\n</user_query>`,
        },
      ],
    },
  })}\n`
}

function turnEnded(status: string): string {
  return `${JSON.stringify({ type: 'turn_ended', status })}\n`
}

function writeTranscript(
  directory: string,
  id: string,
  prompt: string,
  status: string | null,
): string {
  const file = path.join(directory, `${id}.jsonl`)

  mkdirSync(directory, { recursive: true })
  writeFileSync(file, userRecord(prompt) + (status ? turnEnded(status) : ''))

  return file
}

test('a child that calls no tool is found by its launch digest from either id', () => {
  const { root, parentTranscript, subagents } = setup('agent-discovery-')

  launch(root, parentTranscript, 'toolu_a', 'Review change A.')
  launch(root, parentTranscript, 'toolu_b', 'Review change B.')
  writeTranscript(subagents, 'uuid-other', 'Unrelated task.', 'success')
  writeTranscript(subagents, 'uuid-a', 'Review change A.', 'success')
  writeTranscript(subagents, 'uuid-b', 'Review change B.', 'success')

  // The parent holds the conversation id.
  assert.equal(readAgentStop(root, 'uuid-a', Date.now())?.status, 'completed')
  assert.equal(getAgentEntry(root, 'uuid-a')?.agent_id, 'toolu_a')

  // The hooks hold the tool call id.
  assert.equal(readAgentStop(root, 'toolu_b', Date.now())?.status, 'completed')

  const aliases = readAgentIndex(root).aliases

  assert.equal(aliases['uuid-a'], 'toolu_a')
  assert.equal(aliases['uuid-b'], 'toolu_b')
  assert.equal(aliases['uuid-other'], undefined)
})

test('launches with one prompt stay unlinked, and each transcript still reads its own stop', () => {
  const { root, parentTranscript, subagents } = setup('agent-same-prompt-')

  launch(root, parentTranscript, 'toolu_x', 'Same task.')
  launch(root, parentTranscript, 'toolu_y', 'Same task.')
  writeTranscript(subagents, 'uuid-x', 'Same task.', 'success')
  writeTranscript(subagents, 'uuid-y', 'Same task.', null)

  assert.equal(readAgentStop(root, 'uuid-x', Date.now())?.status, 'completed')
  assert.equal(readAgentStop(root, 'uuid-y', Date.now()), null)
  assert.equal(readAgentStop(root, 'toolu_x', Date.now()), null)

  const aliases = readAgentIndex(root).aliases

  assert.equal(aliases['uuid-x'], undefined)
  assert.equal(aliases['uuid-y'], undefined)
})

test('an older launch of the same prompt does not block the link', (t) => {
  const { root, parentTranscript, subagents } = setup('agent-stale-prompt-')

  launch(root, parentTranscript, 'toolu_old', 'Same task.')
  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const old = index.agents.find((agent) => agent.agent_id === 'toolu_old')

    assert.ok(old)
    old.registered_at = new Date(Date.now() - 3_600_000).toISOString()
    writeIndex(root, index, new Date().toISOString())
  })
  launch(root, parentTranscript, 'toolu_new', 'Same task.')

  const file = writeTranscript(subagents, 'uuid-new', 'Same task.', 'success')

  if (!(statSync(file).birthtimeMs > 0)) {
    t.skip('this file system records no creation time')
    return
  }

  assert.equal(
    readAgentStop(root, 'toolu_new', Date.now())?.status,
    'completed',
  )
  assert.equal(readAgentIndex(root).aliases['uuid-new'], 'toolu_new')
})

test('an unindexed transcript resolves to an unsaved entry that reads its stop', () => {
  const { root, parentTranscript, subagents } = setup('agent-orphan-')

  launch(root, parentTranscript, 'toolu_a', 'Review change A.')
  writeTranscript(
    subagents,
    'uuid-orphan',
    'Launched before the hooks.',
    'aborted',
  )

  assert.equal(
    readAgentStop(root, 'uuid-orphan', Date.now())?.status,
    'aborted',
  )
  assert.equal(
    readAgentIndex(root).agents.some(
      (agent) => agent.agent_id === 'uuid-orphan',
    ),
    false,
  )
  assert.equal(getAgentEntry(root, 'uuid-missing'), null)
})

test('a resumed child joins its entry and its earlier turn end is not its stop', () => {
  const { root, parentTranscript, subagents } = setup('agent-resume-')

  launch(root, parentTranscript, 'toolu_1', 'Review the change.')

  const file = writeTranscript(
    subagents,
    'uuid-1',
    'Review the change.',
    'success',
  )

  assert.equal(readAgentStop(root, 'uuid-1', Date.now())?.status, 'completed')

  const endedMs = statSync(file).mtimeMs

  while (Date.now() <= endedMs + 1) {
    // The resume registers after the earlier turn ended.
  }

  launch(root, parentTranscript, 'toolu_2', 'Fix finding 1.', 'uuid-1')

  const entry = getAgentEntry(root, 'toolu_2')

  assert.equal(entry?.agent_id, 'toolu_1')
  assert.equal(entry?.status, 'running')
  assert.equal(
    readAgentIndex(root).agents.some((agent) => agent.agent_id === 'toolu_2'),
    false,
    'the resume started no second entry',
  )
  assert.equal(readAgentStop(root, 'uuid-1', Date.now()), null)

  appendFileSync(file, userRecord('Fix finding 1.') + turnEnded('success'))

  assert.equal(readAgentStop(root, 'uuid-1', Date.now())?.status, 'completed')
})

test('a resume of an unindexed child links the resumed id to the new entry', () => {
  const { root, parentTranscript } = setup('agent-resume-unknown-')

  launch(root, parentTranscript, 'toolu_3', 'Continue.', 'uuid-unindexed')

  assert.equal(getAgentEntry(root, 'uuid-unindexed')?.agent_id, 'toolu_3')
})
