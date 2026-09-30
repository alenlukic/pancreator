import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function write(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf8')
}

export function writeWorkflowSnapshot(runDirectory: string): void {
  write(
    path.join(runDirectory, 'workflow.snapshot.json'),
    `${JSON.stringify({
      stages: [{ slug: 'plan' }, { slug: 'implement' }, { slug: 'verify' }],
    })}\n`,
  )
}

export function writeEvents(
  runDirectory: string,
  invocationIds: string[],
): void {
  const events = invocationIds.map((invocationId, index) =>
    JSON.stringify({
      schema_version: 1,
      type: 'invocation_prepared',
      timestamp: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      invocation_id: invocationId,
    }),
  )

  write(path.join(runDirectory, 'events.jsonl'), `${events.join('\n')}\n`)
}

export function writeInvocation(
  runDirectory: string,
  runId: string,
  invocationId: string,
  index: number,
): void {
  write(
    path.join(runDirectory, 'invocations', `${invocationId}.json`),
    `${JSON.stringify({
      run_id: runId,
      invocation_id: invocationId,
      created_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
      output: {
        path: `runtime/logs/workflows/${runId}/outputs/${invocationId}.json`,
      },
    })}\n`,
  )
}

export function writeState(
  rootOrDirectory: string,
  runId: string,
  status: 'running' | 'succeeded',
  invocationIds: string[] = [],
  createdAt = '2026-06-22T21:22:54.051Z',
): void {
  const runDirectory = invocationIds.length
    ? rootOrDirectory
    : path.join(rootOrDirectory, 'runtime/logs/workflows', runId)

  write(
    path.join(runDirectory, 'state.json'),
    `${JSON.stringify({
      schema_version: 1,
      run_id: runId,
      workflow_slug: 'delivery',
      title: 'fixture',
      status,
      pending_action: {
        type: status === 'running' ? 'prepare_invocation' : 'none',
      },
      stage_history: invocationIds.map((invocationId, index) => ({
        invocation_id: invocationId,
        submitted_at: new Date(Date.UTC(2026, 5, 22, 21, index)).toISOString(),
        record_path: `runtime/logs/workflows/${runId}/records/${invocationId}.md`,
      })),
      attempts: {},
      created_at: createdAt,
    })}\n`,
  )

  if (invocationIds.length === 0) {
    write(
      path.join(runDirectory, 'workflow.snapshot.json'),
      `${JSON.stringify({ stages: [{ slug: 'plan' }] })}\n`,
    )
    write(path.join(runDirectory, 'events.jsonl'), '')
  }
}
