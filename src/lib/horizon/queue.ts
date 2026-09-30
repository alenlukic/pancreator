/** Task queue parsing, the dependency cycle check, and task eligibility. */

import { isRecord } from '../io.js'
import {
  HORIZON_ID,
  fail,
  parseStringArray,
  requireString,
  type HorizonQueueInput,
  type HorizonQueueTaskInput,
  type HorizonSessionState,
  type HorizonTask,
} from './session.js'

/** Parse and validate a queue before any session state is written. */
export function parseHorizonQueue(
  value: unknown,
  source = 'horizon queue',
): HorizonQueueInput {
  if (
    !isRecord(value) ||
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0
  ) {
    fail(`${source}.tasks MUST contain at least one task.`)
  }

  const tasks = value.tasks.map((task, index): HorizonQueueTaskInput => {
    const item = `${source}.tasks[${index}]`

    if (!isRecord(task)) {
      fail(`${item} MUST be an object.`)
    }

    const kind = task.kind

    if (kind !== 'workflow' && kind !== 'prompt') {
      fail(`${item}.kind MUST be 'workflow' or 'prompt'.`)
    }

    const parsed: HorizonQueueTaskInput = {
      id: requireString(task.id, `${item}.id`),
      title: requireString(task.title, `${item}.title`),
      kind,
      depends_on: parseStringArray(task.depends_on, `${item}.depends_on`),
      ...(typeof task.workflow === 'string' ? { workflow: task.workflow } : {}),
      ...(typeof task.request_path === 'string'
        ? { request_path: task.request_path }
        : {}),
      ...(typeof task.prompt === 'string' ? { prompt: task.prompt } : {}),
      ...(typeof task.workspace === 'string'
        ? { workspace: task.workspace }
        : {}),
      ...(typeof task.worktree === 'string' ? { worktree: task.worktree } : {}),
      ...(Array.isArray(task.grants)
        ? {
            grants: task.grants.map((grant, grantIndex) => {
              if (!isRecord(grant)) {
                fail(`${item}.grants[${grantIndex}] MUST be an object.`)
              }

              return {
                name: requireString(
                  grant.name,
                  `${item}.grants[${grantIndex}].name`,
                ),
                path: requireString(
                  grant.path,
                  `${item}.grants[${grantIndex}].path`,
                ),
              }
            }),
          }
        : {}),
    }

    // A task id names an inbox file, a prompt card, and a deferral record,
    // so it is refused at parse time under the session-id pattern rather
    // than at the first write that interpolates it.
    if (!HORIZON_ID.test(parsed.id)) {
      fail(`${item}.id MUST match ${HORIZON_ID.source}.`)
    }

    if (kind === 'workflow' && !parsed.request_path) {
      fail(`${item}.request_path is required for a workflow task.`)
    }

    if (kind === 'prompt' && !parsed.prompt) {
      fail(`${item}.prompt is required for a prompt task.`)
    }

    if (parsed.workspace && parsed.worktree) {
      fail(`${item} MUST NOT set both workspace and worktree.`)
    }

    return parsed
  })
  const ids = tasks.map((task) => task.id)

  if (new Set(ids).size !== ids.length) {
    fail(`${source}.tasks contains a duplicate task id.`)
  }

  const edges = Array.isArray(value.edges)
    ? value.edges.map((edge, index) => {
        if (!isRecord(edge)) {
          fail(`${source}.edges[${index}] MUST be an object.`)
        }

        return {
          from: requireString(edge.from, `${source}.edges[${index}].from`),
          to: requireString(edge.to, `${source}.edges[${index}].to`),
        }
      })
    : []
  const known = new Set(ids)

  for (const task of tasks) {
    for (const dependency of task.depends_on ?? []) {
      if (!known.has(dependency)) {
        fail(`Task '${task.id}' depends on unknown task '${dependency}'.`)
      }
    }
  }

  for (const edge of edges) {
    if (!known.has(edge.from) || !known.has(edge.to)) {
      fail(
        `Dependency edge '${edge.from} -> ${edge.to}' names an unknown task.`,
      )
    }
  }

  const merged = tasks.map((task) => ({
    ...task,
    depends_on: [
      ...new Set([
        ...(task.depends_on ?? []),
        ...edges.filter((edge) => edge.to === task.id).map((edge) => edge.from),
      ]),
    ],
  }))
  const cycle = horizonCycle(merged)

  if (cycle) {
    fail(`Horizon queue contains a dependency cycle: ${cycle.join(' -> ')}.`)
  }

  return {
    schema_version: 1,
    ...(typeof value.involvement_profile === 'string'
      ? { involvement_profile: value.involvement_profile }
      : {}),
    tasks: merged,
    edges: merged.flatMap((task) =>
      (task.depends_on ?? []).map((dependency) => ({
        from: dependency,
        to: task.id,
      })),
    ),
  }
}

/** Return one named dependency cycle, including the repeated closing node. */
export function horizonCycle(
  tasks: ReadonlyArray<Pick<HorizonQueueTaskInput, 'id' | 'depends_on'>>,
): string[] | null {
  const dependencies = new Map(
    tasks.map((task) => [task.id, task.depends_on ?? []]),
  )
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const stack: string[] = []

  const visit = (taskId: string): string[] | null => {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId)
      return [...stack.slice(start), taskId]
    }

    if (visited.has(taskId)) {
      return null
    }

    visiting.add(taskId)
    stack.push(taskId)

    for (const dependency of dependencies.get(taskId) ?? []) {
      const found = visit(dependency)

      if (found) {
        return found
      }
    }

    stack.pop()
    visiting.delete(taskId)
    visited.add(taskId)
    return null
  }

  for (const task of tasks) {
    const found = visit(task.id)

    if (found) {
      return found
    }
  }

  return null
}

/**
 * Returns the ids of every task that depends on the given task directly or
 * transitively, in the session's declared task order.
 */
export function transitiveHorizonDependents(
  state: Pick<HorizonSessionState, 'tasks'>,
  taskId: string,
): string[] {
  const found = new Set<string>()
  const pending = [taskId]

  while (pending.length > 0) {
    const dependency = pending.shift() as string

    for (const task of state.tasks) {
      if (found.has(task.id) || !task.depends_on.includes(dependency)) {
        continue
      }

      found.add(task.id)
      pending.push(task.id)
    }
  }

  return state.tasks.filter((task) => found.has(task.id)).map((task) => task.id)
}

/** Select the first eligible task in declared order. */
export function eligibleHorizonTask(
  state: Pick<HorizonSessionState, 'tasks'>,
): HorizonTask | null {
  const byId = new Map(state.tasks.map((task) => [task.id, task]))

  for (const task of state.tasks) {
    if (task.status !== 'pending') {
      continue
    }

    if (
      task.depends_on.every(
        (dependency) => byId.get(dependency)?.status === 'succeeded',
      )
    ) {
      return task
    }
  }

  return null
}
