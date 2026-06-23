#!/usr/bin/env node
import { readdirSync } from 'node:fs'
import path from 'node:path'

import {
  abortRun,
  acceptChange,
  assessStage,
  createRun,
  decideRun,
  getRunStatus,
  prepareInvocation,
  resumeRun,
  submitOutput,
} from './lib/engine.js'
import { PanError } from './lib/errors.js'
import { isGitRepository } from './lib/git.js'
import { fileExists, findProjectRoot, isRecord, readJson } from './lib/io.js'
import type { RunState } from './lib/types.js'
import { validateRepository } from './lib/validation.js'

const HELP = `Pancreator v2 prototype

Usage:
  pan init --request <repo-relative-file> [--workflow dev] [--title <title>]
  pan prepare <run-id>
  pan submit <run-id> <output-json>
  pan assess <run-id> <assessment-json>
  pan decide <run-id> <approve|reject> [--note <text>]
  pan resume <run-id> [--stage <stage-slug>]
  pan accept-change <run-id> [--note <text>]
  pan abort <run-id> [--note <text>]
  pan status <run-id> [--json]
  pan list [--json]
  pan validate [--json]
  pan doctor [--json]

The harness does not invoke models. Cursor's supervisor reads invocation cards,
delegates to named Cursor subagents, and returns structured output to this CLI.
`

function option(
  args: string[],
  name: string,
  fallback: string | null = null,
): string | null {
  const index = args.indexOf(name)

  if (index === -1) {
    return fallback
  }

  const value = args[index + 1]

  if (!value || value.startsWith('--')) {
    throw new PanError(`${name} requires a value.`, {
      code: 'INVALID_ARGUMENT',
    })
  }

  return value
}

function requiredArgument(value: string | undefined, name: string): string {
  if (!value) {
    throw new PanError(`${name} is required.`, { code: 'INVALID_ARGUMENT' })
  }

  return value
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name)
}

function print(value: unknown, asJson = false): void {
  if (asJson || typeof value !== 'string') {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  } else {
    process.stdout.write(value.endsWith('\n') ? value : `${value}\n`)
  }
}

function parseRunState(value: unknown, source: string): RunState {
  if (
    !isRecord(value) ||
    typeof value.run_id !== 'string' ||
    typeof value.status !== 'string'
  ) {
    throw new PanError(`${source} does not contain a valid run state.`, {
      code: 'INVALID_STATE',
    })
  }

  return value as unknown as RunState
}

function listRuns(root: string): Array<Record<string, unknown>> {
  const base = path.join(root, 'runtime', 'logs', 'workflows')

  if (!fileExists(base)) {
    return []
  }

  return readdirSync(base, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fileExists(path.join(base, entry.name, 'state.json')),
    )
    .map((entry) => {
      const statePath = path.join(base, entry.name, 'state.json')

      return parseRunState(readJson(statePath), statePath)
    })
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((state) => ({
      run_id: state.run_id,
      title: state.title,
      status: state.status,
      stage: state.current_stage,
      pending_action: state.pending_action.type,
      updated_at: state.updated_at,
    }))
}

async function main(): Promise<void> {
  const root = findProjectRoot()
  const [command = 'help', ...args] = process.argv.slice(2)
  const json = hasFlag(args, '--json')

  switch (command) {
    case 'help':
    case '--help':
    case '-h':
      print(HELP)
      return
    case 'init': {
      const state = createRun(root, {
        workflowSlug: option(args, '--workflow', 'dev') ?? 'dev',
        requestPath: option(args, '--request'),
        title: option(args, '--title'),
      })

      print({
        status: 'created',
        run_id: state.run_id,
        next_command: `./bin/pan prepare ${state.run_id}`,
        state_path: `runtime/logs/workflows/${state.run_id}/state.json`,
      })
      return
    }
    case 'prepare': {
      const runId = requiredArgument(args[0], 'run-id')
      const result = prepareInvocation(root, runId)

      if (!result.invocation) {
        print({
          status: result.state.status,
          reason: result.state.pause_reason,
          decision_path: result.state.last_decision_path,
        })
        return
      }

      print({
        status: 'ready',
        run_id: runId,
        stage: result.invocation.stage.slug,
        persona: result.invocation.stage.persona,
        invocation_json: result.state.current_invocation?.json_path,
        invocation_markdown: result.state.current_invocation?.markdown_path,
        expected_output: result.state.current_invocation?.output_path,
      })
      return
    }
    case 'submit': {
      const runId = requiredArgument(args[0], 'run-id')
      const outputPath = requiredArgument(args[1], 'output-json')
      const result = submitOutput(root, runId, outputPath)

      print({
        status: result.state.status,
        outcome: result.record.outcome,
        stage: result.record.stage.slug,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
      })
      return
    }
    case 'assess': {
      const runId = requiredArgument(args[0], 'run-id')
      const assessmentPath = requiredArgument(args[1], 'assessment-json')
      const result = assessStage(root, runId, assessmentPath)

      print({
        status: result.state.status,
        verdict: result.assessment.verdict,
        next_stage: result.state.current_stage,
        pending_action: result.state.pending_action,
      })
      return
    }
    case 'decide': {
      const runId = requiredArgument(args[0], 'run-id')
      const decision = requiredArgument(args[1], 'decision')
      const state = decideRun(
        root,
        runId,
        decision,
        option(args, '--note', '') ?? '',
      )

      print({
        status: state.status,
        next_stage: state.current_stage,
        pending_action: state.pending_action,
      })
      return
    }
    case 'resume': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = resumeRun(root, runId, option(args, '--stage'))

      print({
        status: state.status,
        current_stage: state.current_stage,
        next_command: `./bin/pan prepare ${runId}`,
      })
      return
    }
    case 'accept-change': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = acceptChange(root, runId, option(args, '--note', '') ?? '')

      print({
        status: state.status,
        current_stage: state.current_stage,
        accepted_workspace_fingerprint: state.accepted_workspace_fingerprint,
        next_command: `./bin/pan prepare ${runId}`,
      })
      return
    }
    case 'abort': {
      const runId = requiredArgument(args[0], 'run-id')
      const state = abortRun(root, runId, option(args, '--note', '') ?? '')

      print({ status: state.status, run_id: runId })
      return
    }
    case 'status': {
      const runId = requiredArgument(args[0], 'run-id')
      print(getRunStatus(root, runId, { json }), json)
      return
    }
    case 'list':
      print(listRuns(root), true)
      return
    case 'validate': {
      const result = validateRepository(root)
      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    case 'doctor': {
      const validation = validateRepository(root)
      const nodeMajor = Number(process.versions.node.split('.')[0])
      const result = {
        ok: validation.ok && nodeMajor >= 22,
        node: {
          version: process.versions.node,
          supported: nodeMajor >= 22,
        },
        git: { available_repository: isGitRepository(root) },
        validation,
        constraints: {
          runtime_dependencies: 0,
          development_tools: ['TypeScript', 'Prettier'],
          orchestration_runtime: 'Cursor supervisor + repository state machine',
          supported_integrations: [
            'Cursor subagents',
            'Cursor commands',
            'Cursor rules',
            'MCP tools available to Cursor',
          ],
        },
      }

      print(result, true)

      if (!result.ok) {
        process.exitCode = 1
      }
      return
    }
    default:
      throw new PanError(`Unknown command: ${command}\n\n${HELP}`, {
        code: 'UNKNOWN_COMMAND',
      })
  }
}

main().catch((error: unknown) => {
  const known = error instanceof PanError
  const message = error instanceof Error ? error.message : String(error)
  const payload = {
    error: known ? error.code : 'UNEXPECTED_ERROR',
    message,
    ...(known && error.details !== undefined ? { details: error.details } : {}),
  }

  process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`)
  process.exitCode = known ? error.exitCode : 1
})
