import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { loadPolicyCatalog } from '../../src/lib/policies.js'

const REPO_ROOT = process.cwd()

/**
 * `ORCH-001` requires the supervisor to launch stage workers from the top level,
 * because Cursor silently drops a projected model mapping for any spawn made
 * from inside another subagent. v4.0.0 changed that rule but left `/pan-start`
 * and `/pan-resume` mandating a nested `pan-orchestrator`, so every entry point
 * still downgraded the stage workers it launched. These assertions pin the
 * entry-point half of the contract, which no earlier test covered.
 */
const ENTRY_COMMANDS = [
  'library/cursor/commands/pan-start.md',
  'library/cursor/commands/pan-resume.md',
] as const

/** Wording that would put the supervisor back below the session root. */
const NESTED_SUPERVISOR_PATTERNS = [
  /invoke the `pan-orchestrator` subagent/iu,
  /launch the `pan-orchestrator` subagent with/iu,
  /you relay between the operator and that subagent/iu,
  /MUST NOT initialize, prepare, submit, assess, decide/iu,
] as const

function read(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

test('workflow entry points supervise in the operator session', () => {
  for (const commandPath of ENTRY_COMMANDS) {
    const body = read(commandPath)

    for (const pattern of NESTED_SUPERVISOR_PATTERNS) {
      assert.ok(
        !pattern.test(body),
        `${commandPath} MUST NOT delegate the supervisor to a child agent: ${String(pattern)}`,
      )
    }

    assert.match(
      body,
      /adopt `library\/personas\/orchestrator\.md`/iu,
      `${commandPath} MUST adopt the supervisor brief inline`,
    )
    assert.match(
      body,
      /MUST NOT launch the `pan-orchestrator` subagent/iu,
      `${commandPath} MUST forbid launching the supervisor subagent`,
    )
    assert.match(
      body,
      /from this session/iu,
      `${commandPath} MUST launch stage workers from the entry session`,
    )
  }
})

test('the supervisor brief describes a top-level session supervisor', () => {
  const brief = read('library/personas/orchestrator.md')

  assert.ok(
    !/You run as the `pan-orchestrator` subagent/iu.test(brief),
    'the brief MUST NOT declare itself a subagent',
  )
  assert.ok(
    !/The invoking command holds the operator conversation/iu.test(brief),
    'the brief MUST NOT assume a relaying parent',
  )
  assert.match(brief, /You MUST run at the top level of the agent hierarchy/iu)
  assert.match(brief, /You hold the operator conversation yourself/iu)
})

test('the orchestrator agent refuses ordinary run supervision', () => {
  const agent = read('library/cursor/agents/orchestrator.md')

  assert.match(
    agent,
    /You MUST refuse and stop when your prompt is a `start` or `resume` invocation for an ordinary run/u,
    'the agent definition MUST refuse an ordinary run so a slash invocation cannot nest the supervisor',
  )
  assert.match(agent, /`\/pan-start`/u)
})

test('policy carries the entry-point and refusal clauses', () => {
  const catalog = loadPolicyCatalog(REPO_ROOT)
  const orch = catalog.get('ORCH-001')
  const invocation = catalog.get('INVOCATION-001')

  assert.ok(orch)
  assert.ok(invocation)

  const orchText = orch.instructions.join('\n')
  const invocationText = invocation.instructions.join('\n')

  assert.match(
    orchText,
    /Every public workflow entry point MUST execute the supervisor in the operator's own session/u,
  )
  assert.match(orchText, /MUST refuse before calling the subagent/u)
  assert.match(
    orchText,
    /It MUST name `\/pan-start` or `\/pan-resume` instead/u,
  )
  assert.match(
    invocationText,
    /The top-level requirement applies transitively to command templates, agent-slash resolution, and resume paths/u,
  )
})

/**
 * The always-applied rule is the only surface a session sees when the platform
 * injects delegation context from a bare `/pan-orchestrator` mention: no command
 * template is loaded on that path, so the guard cannot live in one.
 */
test('always-applied rules carry the injected-delegation guard', () => {
  for (const rulePath of [
    'library/cursor/rules/pancreator-embedded.mdc',
    'library/cursor/rules/pancreator-self-development.mdc',
  ]) {
    const body = read(rulePath)

    assert.match(
      body,
      /A workflow supervisor MUST run in the operator's own session/u,
      `${rulePath} MUST state where the supervisor runs`,
    )
    assert.match(
      body,
      /you MUST refuse before calling the subagent/u,
      `${rulePath} MUST require refusal of injected supervisor delegation`,
    )
  }
})
