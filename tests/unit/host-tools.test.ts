import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  allHostToolNames,
  hostToolPolicyIssues,
  loadHostToolRegistry,
  parseHostToolRegistry,
} from '../../src/lib/host-tools.js'
import { validateHostToolRegistry } from '../../src/lib/validation.js'

function registryJson(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      path.join(process.cwd(), 'governance/registries/host_tools.json'),
      'utf8',
    ),
  ) as Record<string, unknown>
}

test('the shipped registry parses and agrees with its owning policies', () => {
  const registry = loadHostToolRegistry(process.cwd())

  assert.deepEqual(allHostToolNames(registry, 'question_tool'), [
    'cursor/ask_question',
    'vscode/askQuestions',
    'ask_user',
  ])
  assert.deepEqual(registry.terms.subagent_launch.background?.cursor, {
    argument: 'run_in_background',
    value: true,
  })
  assert.equal(registry.terms.subagent_launch.background?.vscode, null)
  assert.deepEqual(registry.terms.subagent_launch.background?.['copilot-cli'], {
    argument: 'mode',
    value: 'background',
  })
  assert.deepEqual(registry.terms.platform_await.when_argument, {
    'copilot-cli': { read_bash: 'delay', read_agent: 'wait' },
  })
  assert.deepEqual(allHostToolNames(registry, 'agent_session'), [
    'create_session',
    'send_message',
  ])
  assert.deepEqual(validateHostToolRegistry(process.cwd()), [])
})

test('a malformed registry fails with INVALID_HOST_TOOLS', async (t) => {
  const cases: Array<[string, (value: Record<string, unknown>) => void]> = [
    [
      'a missing host column',
      (value) => {
        const terms = value.terms as Record<
          string,
          { tools: Record<string, unknown> }
        >
        delete terms.shell?.tools.vscode
      },
    ],
    [
      'an empty tool name',
      (value) => {
        const terms = value.terms as Record<
          string,
          { tools: Record<string, unknown> }
        >
        if (terms.shell) terms.shell.tools.cursor = ['']
      },
    ],
    [
      'an unknown term',
      (value) => {
        ;(value.terms as Record<string, unknown>).extra = {}
      },
    ],
    [
      'a malformed background entry',
      (value) => {
        const terms = value.terms as Record<
          string,
          { background: Record<string, unknown> }
        >
        if (terms.subagent_launch)
          terms.subagent_launch.background.cursor = { value: true }
      },
    ],
    [
      'a when_argument for a tool the host does not list',
      (value) => {
        const terms = value.terms as Record<string, Record<string, unknown>>
        if (terms.platform_await)
          terms.platform_await.when_argument = {
            vscode: { read_bash: 'delay' },
          }
      },
    ],
  ]

  for (const [label, mutate] of cases) {
    await t.test(label, () => {
      const value = registryJson()
      mutate(value)
      assert.throws(() => parseHostToolRegistry(value), {
        code: 'INVALID_HOST_TOOLS',
      })
    })
  }
})

test('policy drift names each tool the owning policy omits and each missing policy', () => {
  const registry = parseHostToolRegistry(registryJson())
  const issues = hostToolPolicyIssues(registry, (policyId) =>
    policyId === 'ASK-001' ? 'Use `cursor/ask_question` or `ask_user`.' : null,
  )

  assert.ok(
    issues.some((issue) => issue.includes('`vscode/askQuestions`')),
    issues.join('\n'),
  )
  assert.ok(!issues.some((issue) => issue.includes('`ask_user`')))
  assert.ok(
    issues.some((issue) =>
      issue.includes('missing owning policy DELEGATE-001'),
    ),
  )
})
