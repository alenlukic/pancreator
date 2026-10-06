/**
 * The Cursor hook event handlers that feed the agent index. The hook entry
 * point loads this module and `store.ts`, and nothing on the reader side.
 */

import path from 'node:path'

import {
  MAX_TRANSCRIPT_PATH_CHARS,
  SCHEMA_VERSION,
  appendEvent,
  boundedSummary,
  collectSecrets,
  ensureAgentsDir,
  findAgent,
  heartbeatDue,
  isRecord,
  linkAlias,
  lockPath,
  newAgentEntry,
  nonEmptyString,
  parseRunInvocation,
  parseToolInput,
  promptDigest,
  readIndex,
  redact,
  resolveActor,
  resolveCanonicalId,
  resolveEventFileId,
  summarizeToolInput,
  touch,
  withLock,
  writeIndex,
  type AgentIndex,
  type AgentStatus,
  type EventKind,
  type PendingLaunch,
  type PostToolUsePayload,
  type PreToolUsePayload,
  type SubagentStartPayload,
  type SubagentStopPayload,
  type AgentEvent,
} from './store.js'
import { validatedParentTranscriptPath } from './transcript.js'
import { allHostToolNames, loadHostToolRegistry } from '../host-tools.js'

// ---------------------------------------------------------------------------
// Public event handlers
// ---------------------------------------------------------------------------

const AGENT_HANDLE_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u

/**
 * Every host's subagent launch tool. A hook must still record a Cursor
 * launch when the registry is unreadable, so `Task` is the fallback.
 */
function subagentLaunchTools(root: string): ReadonlySet<string> {
  try {
    return new Set(
      allHostToolNames(loadHostToolRegistry(root), 'subagent_launch'),
    )
  } catch {
    return new Set(['Task'])
  }
}

/** The agent a `Task` call's `resume` names, or null for a fresh or self-forked launch. */
function resumeTarget(value: unknown): string | null {
  const target = nonEmptyString(value)

  return target !== null &&
    target !== 'self' &&
    AGENT_HANDLE_PATTERN.test(target)
    ? target
    : null
}

function canonicalAgentId(
  index: ReturnType<typeof readIndex>,
  rawId: string,
  parentToolCallId: string | null,
): string {
  return (
    resolveCanonicalId(index, rawId) ??
    (parentToolCallId !== null
      ? resolveCanonicalId(index, parentToolCallId)
      : null) ??
    rawId
  )
}

function appendToolEvent(
  root: string,
  rawId: string,
  parentToolCallId: string | null,
  event: AgentEvent,
): void {
  const index = readIndex(root)
  const fileId = resolveEventFileId(index, rawId, parentToolCallId)

  appendEvent(root, fileId, {
    ...event,
    agent_id: canonicalAgentId(index, rawId, parentToolCallId),
  })
}

/**
 * Handle `preToolUse`: append `call_started`, and for a `Task` call record a
 * pending launch keyed by parent and `tool_use_id`.
 */
export function handlePreToolUse(
  root: string,
  payload: PreToolUsePayload,
): void {
  const rawId = nonEmptyString(payload.conversation_id)

  if (!rawId) {
    return
  }

  const nowIso = new Date().toISOString()
  const secrets = collectSecrets(root)
  const toolName = nonEmptyString(payload.tool_name) ?? 'unknown'
  const toolUseId = nonEmptyString(payload.tool_use_id) ?? ''
  const summary = summarizeToolInput(toolName, payload.tool_input, secrets)

  ensureAgentsDir(root)
  const parentToolCallId = nonEmptyString(payload.parent_tool_call_id)

  appendToolEvent(root, rawId, parentToolCallId, {
    schema_version: SCHEMA_VERSION,
    kind: 'call_started',
    agent_id: rawId,
    timestamp: nowIso,
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(summary !== undefined ? { summary } : {}),
  })

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const { entry, changed } = resolveActor(
      index,
      rawId,
      parentToolCallId,
      nowIso,
    )

    if (subagentLaunchTools(root).has(toolName)) {
      const input = parseToolInput(payload.tool_input)
      const launch: PendingLaunch = {
        parent_agent_id: entry.agent_id,
        tool_use_id: toolUseId,
        prompt_digest: promptDigest(nonEmptyString(input?.prompt)),
        subagent_type:
          nonEmptyString(input?.subagent_type) ??
          nonEmptyString(input?.agent_type) ??
          nonEmptyString(input?.agentName),
        description:
          input && nonEmptyString(input.description)
            ? boundedSummary(input.description as string, secrets)
            : null,
        requested_at: nowIso,
        resume_of: resumeTarget(input?.resume),
        handle: null,
        resolved_agent_id: null,
      }
      const existing = index.pending_launches.findIndex(
        (pl) =>
          pl.parent_agent_id === entry.agent_id && pl.tool_use_id === toolUseId,
      )

      if (existing >= 0) {
        index.pending_launches[existing] = launch
      } else {
        index.pending_launches.push(launch)
      }

      touch(entry, nowIso, 'launch_requested')
      writeIndex(root, index, nowIso)
      return
    }

    if (changed || heartbeatDue(entry, nowIso)) {
      touch(entry, nowIso, 'call_started')
      writeIndex(root, index, nowIso)
    }
  })
}

/**
 * Handle `postToolUse` or `postToolUseFailure`. For a returned `Task`, parse
 * the agent handle into an alias; the output body is never stored.
 */
export function handlePostToolUse(
  root: string,
  payload: PostToolUsePayload,
): void {
  const rawId = nonEmptyString(payload.conversation_id)

  if (!rawId) {
    return
  }

  const nowIso = new Date().toISOString()
  const failed = payload.event === 'postToolUseFailure'
  const kind: EventKind = failed ? 'call_failed' : 'call_finished'
  const toolName = nonEmptyString(payload.tool_name) ?? 'unknown'
  const toolUseId = nonEmptyString(payload.tool_use_id) ?? ''
  const failureType = failed ? nonEmptyString(payload.failure_type) : null

  ensureAgentsDir(root)
  const parentToolCallId = nonEmptyString(payload.parent_tool_call_id)

  appendToolEvent(root, rawId, parentToolCallId, {
    schema_version: SCHEMA_VERSION,
    kind,
    agent_id: rawId,
    timestamp: nowIso,
    tool_name: toolName,
    tool_use_id: toolUseId,
    ...(failureType ? { failure_type: failureType.slice(0, 64) } : {}),
  })

  const handle =
    !failed && subagentLaunchTools(root).has(toolName)
      ? extractTaskHandle(payload.tool_output)
      : null

  if (handle !== null) {
    appendToolEvent(root, rawId, parentToolCallId, {
      schema_version: SCHEMA_VERSION,
      kind: 'launch_returned',
      agent_id: rawId,
      timestamp: nowIso,
      tool_name: toolName,
      tool_use_id: toolUseId,
      summary: handle,
    })
  }

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const { entry, changed } = resolveActor(
      index,
      rawId,
      parentToolCallId,
      nowIso,
    )

    if (handle !== null) {
      const launch = index.pending_launches.find(
        (pl) =>
          pl.parent_agent_id === entry.agent_id && pl.tool_use_id === toolUseId,
      )

      if (launch) {
        launch.handle = handle

        if (launch.resolved_agent_id) {
          linkAlias(index, handle, launch.resolved_agent_id)
        }
      }

      touch(entry, nowIso, 'launch_returned')
      writeIndex(root, index, nowIso)
      return
    }

    if (changed || heartbeatDue(entry, nowIso)) {
      touch(entry, nowIso, kind)
      writeIndex(root, index, nowIso)
    }
  })
}

/**
 * Handle `subagentStart`: register the child, parse its run and invocation,
 * and link the parent's pending launch by `tool_call_id` equality or by
 * parent plus prompt digest. A launch that resumed an indexed agent
 * re-registers that agent under the new tool call id and clears its earlier
 * stop; one that resumed an unindexed agent links the resumed id to the new
 * entry.
 */
export function handleSubagentStart(
  root: string,
  payload: SubagentStartPayload,
): void {
  const subagentId = nonEmptyString(payload.subagent_id)
  const conversationId = nonEmptyString(payload.conversation_id)
  const explicitParent = nonEmptyString(payload.parent_conversation_id)
  const childId = subagentId ?? conversationId

  if (!childId) {
    return
  }

  // Without an explicit parent field, a payload that carries both ids fired
  // in the parent's conversation, so `conversation_id` names the parent.
  const parentId =
    explicitParent ??
    (subagentId && conversationId && conversationId !== subagentId
      ? conversationId
      : null)
  const childConversationId =
    explicitParent &&
    subagentId &&
    conversationId &&
    conversationId !== explicitParent &&
    conversationId !== subagentId
      ? conversationId
      : null
  const toolCallId = nonEmptyString(payload.tool_call_id)
  const secrets = collectSecrets(root)
  const taskText =
    nonEmptyString(payload.task) ?? nonEmptyString(payload.task_text) ?? ''
  const parsed = parseRunInvocation(taskText)
  const digest = promptDigest(taskText)
  const rawParentTranscript = nonEmptyString(payload.transcript_path)
  const parentTranscriptPath = validatedParentTranscriptPath(
    rawParentTranscript !== null ? redact(rawParentTranscript, secrets) : null,
  )
  const nowIso = new Date().toISOString()

  ensureAgentsDir(root)
  appendEvent(root, childId, {
    schema_version: SCHEMA_VERSION,
    kind: 'registered',
    agent_id: childId,
    timestamp: nowIso,
    ...(toolCallId ? { tool_use_id: toolCallId } : {}),
  })

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const parentCanonical =
      parentId !== null
        ? (resolveCanonicalId(index, parentId) ?? parentId)
        : null
    const open =
      parentCanonical !== null
        ? index.pending_launches.filter(
            (pl) =>
              pl.parent_agent_id === parentCanonical &&
              (pl.resolved_agent_id ?? null) === null,
          )
        : []
    const launch =
      (toolCallId
        ? open.find((pl) => pl.tool_use_id === toolCallId)
        : undefined) ??
      (digest ? open.find((pl) => pl.prompt_digest === digest) : undefined)
    const resumeOf = launch?.resume_of ?? null
    // A resumed child keeps its conversation and transcript, so the resume
    // launch joins the entry it resumes rather than starting an empty one.
    const resumed =
      resumeOf !== null ? resolveCanonicalId(index, resumeOf) : null
    const canonical = resolveCanonicalId(index, childId) ?? resumed
    let child = canonical !== null ? findAgent(index, canonical) : null

    if (!child) {
      child = newAgentEntry(childId, nowIso)
      index.agents.push(child)
    }

    if (resumed !== null && child.agent_id === resumed) {
      linkAlias(index, childId, child.agent_id)
      child.stop = null
    } else if (resumeOf !== null) {
      linkAlias(index, resumeOf, child.agent_id)
    }

    child.parent_agent_id = parentCanonical ?? child.parent_agent_id
    child.subagent_type =
      nonEmptyString(payload.subagent_type) ?? child.subagent_type
    child.model = nonEmptyString(payload.model) ?? child.model
    child.prompt_digest = digest ?? child.prompt_digest ?? null
    child.status = 'running'
    touch(child, nowIso, 'registered')

    if (parsed) {
      child.run_id = parsed.run_id
      child.invocation_id = parsed.invocation_id
    }

    if (parentTranscriptPath !== null) {
      child.parent_transcript_path = parentTranscriptPath
    }

    for (const alias of [toolCallId, childConversationId]) {
      if (alias) {
        linkAlias(index, alias, child.agent_id)
      }
    }

    if (launch) {
      launch.resolved_agent_id = child.agent_id

      if (launch.tool_use_id) {
        linkAlias(index, launch.tool_use_id, child.agent_id)
      }

      if (launch.handle) {
        linkAlias(index, launch.handle, child.agent_id)
      }

      child.subagent_type = child.subagent_type ?? launch.subagent_type
    }

    writeIndex(root, index, nowIso)
  })
}

function transcriptKey(transcriptPath: string | null): string | null {
  if (!transcriptPath) {
    return null
  }

  // A Copilot CLI transcript is session-state/<sessionId>/events.jsonl.
  const key =
    path.basename(transcriptPath) === 'events.jsonl'
      ? path.basename(path.dirname(transcriptPath))
      : path.basename(transcriptPath).replace(/\.jsonl?$/u, '')

  return key.length > 0 ? key : null
}

function normalizeStopStatus(value: unknown): AgentStatus {
  return value === 'error' || value === 'aborted' ? value : 'completed'
}

/**
 * Resolve the stopped child in the Q-002 order: `subagent_id`, the transcript
 * basename, a registered child `conversation_id`, then parent plus task-text
 * digest. The parent itself is never the answer. The caller passes the
 * transcript path already redacted, because its basename becomes an alias
 * and, for an unresolved stop, the event file name.
 */
function resolveStoppedChild(
  index: AgentIndex,
  payload: SubagentStopPayload,
  transcriptPath: string | null,
): { canonical: string | null; rawKeys: string[] } {
  const parentId = nonEmptyString(payload.parent_conversation_id)
  const parentCanonical =
    parentId !== null ? (resolveCanonicalId(index, parentId) ?? parentId) : null
  const notParent = (canonical: string | null): string | null =>
    canonical !== null && canonical !== parentCanonical ? canonical : null
  const subagentId = nonEmptyString(payload.subagent_id)
  const transcript = transcriptKey(transcriptPath)
  const rawKeys = [subagentId, transcript].filter(
    (key): key is string => key !== null,
  )

  for (const key of rawKeys) {
    const canonical = notParent(resolveCanonicalId(index, key))

    if (canonical !== null) {
      return { canonical, rawKeys }
    }
  }

  const conversationId = nonEmptyString(payload.conversation_id)

  if (conversationId !== null) {
    const canonical = notParent(resolveCanonicalId(index, conversationId))
    const entry = canonical !== null ? findAgent(index, canonical) : null

    if (entry && entry.parent_agent_id !== null) {
      return { canonical, rawKeys }
    }
  }

  const digest = promptDigest(
    nonEmptyString(payload.task) ?? nonEmptyString(payload.task_text),
  )

  if (parentCanonical !== null && digest !== null) {
    const match = index.agents
      .filter(
        (a) =>
          a.parent_agent_id === parentCanonical &&
          a.prompt_digest === digest &&
          a.status === 'running',
      )
      .sort((a, b) => b.registered_at.localeCompare(a.registered_at))[0]

    if (match) {
      return { canonical: match.agent_id, rawKeys }
    }
  }

  return { canonical: null, rawKeys }
}

/**
 * Handle `subagentStop`: append the stop line first, so lock contention can
 * drop only the index update, then record the stop on the child's entry.
 */
export function handleSubagentStop(
  root: string,
  payload: SubagentStopPayload,
): void {
  const nowIso = new Date().toISOString()
  const status = normalizeStopStatus(payload.status)
  const rawTranscriptPath = nonEmptyString(payload.agent_transcript_path)
  const transcriptPath =
    rawTranscriptPath !== null
      ? redact(rawTranscriptPath, collectSecrets(root))
      : null
  const storedTranscriptPath =
    transcriptPath !== null &&
    transcriptPath.length <= MAX_TRANSCRIPT_PATH_CHARS
      ? transcriptPath
      : null
  const { canonical, rawKeys } = resolveStoppedChild(
    readIndex(root),
    payload,
    transcriptPath,
  )
  const target = canonical ?? rawKeys[0] ?? null

  if (target === null) {
    return
  }

  ensureAgentsDir(root)
  const stopIndex = readIndex(root)
  const stopFileId = resolveEventFileId(stopIndex, target, null)

  appendEvent(root, stopFileId, {
    schema_version: SCHEMA_VERSION,
    kind: 'stopped',
    agent_id: canonicalAgentId(stopIndex, target, null),
    timestamp: nowIso,
    status,
    ...(typeof payload.duration_seconds === 'number'
      ? { duration_ms: Math.round(payload.duration_seconds * 1000) }
      : {}),
    ...(storedTranscriptPath !== null
      ? { transcript_path: storedTranscriptPath }
      : {}),
  })

  withLock(lockPath(root), () => {
    const index = readIndex(root)
    const resolved =
      resolveStoppedChild(index, payload, transcriptPath).canonical ?? target
    let agent = findAgent(
      index,
      resolveCanonicalId(index, resolved) ?? resolved,
    )

    if (!agent) {
      agent = newAgentEntry(resolved, nowIso)
      agent.parent_agent_id = nonEmptyString(payload.parent_conversation_id)
      index.agents.push(agent)
    }

    agent.status = status
    touch(agent, nowIso, 'stopped')
    agent.transcript_path = storedTranscriptPath ?? agent.transcript_path
    agent.stop = {
      status,
      recorded_at: nowIso,
      tool_call_count:
        typeof payload.tool_call_count === 'number'
          ? payload.tool_call_count
          : 0,
      modified_file_count:
        typeof payload.modified_file_count === 'number'
          ? payload.modified_file_count
          : 0,
      duration_seconds:
        typeof payload.duration_seconds === 'number'
          ? payload.duration_seconds
          : null,
    }

    for (const key of rawKeys) {
      linkAlias(index, key, agent.agent_id)
    }

    writeIndex(root, index, nowIso)
  })
}

/**
 * The agent handle a `Task` call returned: a JSON string or an object's id
 * field, else a plain handle token, else an `agent id: <token>` mention.
 */
export function extractTaskHandle(toolOutput: unknown): string | null {
  let output = toolOutput

  if (typeof output === 'string') {
    const trimmed = output.trim()

    try {
      output = JSON.parse(trimmed) as unknown
    } catch {
      output = trimmed
    }
  }

  if (typeof output === 'string') {
    if (/^[A-Za-z0-9_-]{1,128}$/u.test(output)) {
      return output
    }

    const mention =
      /agent[ _-]?id["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{1,128})/iu.exec(output)

    return mention ? (mention[1] as string) : null
  }

  if (isRecord(output)) {
    for (const field of ['agent_id', 'agentId', 'id', 'conversation_id']) {
      const value = nonEmptyString(output[field])

      if (value && /^[A-Za-z0-9_-]{1,128}$/u.test(value)) {
        return value
      }
    }
  }

  return null
}
