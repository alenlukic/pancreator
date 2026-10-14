import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertFixtureTemplateWithinLimit,
  MAX_FIXTURE_TEMPLATE_BYTES,
  pinFixtureCursorExecutors,
} from '../fixture-template.js'

test('fixture template size guard permits the limit and names an excess', () => {
  assert.doesNotThrow(() =>
    assertFixtureTemplateWithinLimit({
      bytes: MAX_FIXTURE_TEMPLATE_BYTES,
      files: 100,
    }),
  )

  const measured = MAX_FIXTURE_TEMPLATE_BYTES + 1024

  assert.throws(
    () =>
      assertFixtureTemplateWithinLimit({
        bytes: measured,
        files: 101,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.includes(String(measured)) &&
      error.message.includes('30 MB limit'),
  )
})

test('fixture config pins Copilot aliases and works without any Cursor defaults', () => {
  const config: Record<string, unknown> = {
    anthropic: {
      advanced: 'copilot:claude-opus-5-5[provider=anthropic,effort=high]',
    },
    defaults: {
      orchestrator: 'copilot:gpt-5.6-sol[provider=openai,effort=high]',
      planner: 'anthropic:advanced',
    },
    configs: {
      default: {},
      flat: { summary: 'Copilot config.', coder: 'anthropic:advanced' },
      nested: { personas: { reviewer: 'anthropic:advanced' } },
    },
  }

  pinFixtureCursorExecutors(config)

  assert.deepEqual(config.defaults, {
    orchestrator: 'gpt-5.6-sol',
    planner: 'gpt-5.6-sol',
  })
  assert.deepEqual(config.configs, {
    default: {},
    flat: { summary: 'Copilot config.', coder: 'gpt-5.6-sol' },
    nested: { personas: { reviewer: 'gpt-5.6-sol' } },
  })
})

test('fixture config routes operator external executor personas to cursor', () => {
  const config: Record<string, unknown> = {
    defaults: {
      planner: 'openai:gpt-6-astra[effort=high]',
      coder: 'open:advanced',
      reviewer: 'claude-code:opus',
    },
    configs: {
      default: {},
      flat: { summary: 'Flat config.', verifier: 'openai:gpt-6' },
      nested: { personas: { qa: 'claude-code:sonnet', designer: 'x:ultra' } },
    },
  }

  pinFixtureCursorExecutors(config)

  assert.deepEqual(config, {
    defaults: {
      planner: 'open:advanced',
      coder: 'open:advanced',
      reviewer: 'open:advanced',
    },
    configs: {
      default: {},
      flat: { summary: 'Flat config.', verifier: 'open:advanced' },
      nested: { personas: { qa: 'open:advanced', designer: 'x:ultra' } },
    },
  })
})
