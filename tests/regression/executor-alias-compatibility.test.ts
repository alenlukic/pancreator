import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  canonicalPersonaMapping,
  personaExecutorOf,
  parsePersonaMapping,
} from '../../src/lib/executors/mapping.js'
import { parsePipelineConfig } from '../../src/lib/pipeline-config.js'
import { syncCursorProjection } from '../../src/lib/projection.js'
import { createFixture } from '../helpers.js'

/**
 * Registering a third executor prefix is the kind of change that silently
 * reinterprets mappings an operator already wrote. Every form below resolved
 * to a Cursor persona before `openai` existed, and MUST still.
 */
const UNCHANGED_SPECS: { spec: string; model: string; canonical: string }[] = [
  {
    spec: 'gpt-5.6-sol',
    model: 'gpt-5.6-sol',
    canonical: 'cursor:gpt-5.6-sol',
  },
  {
    spec: 'composer-2.5-fast',
    model: 'composer-2.5-fast',
    canonical: 'cursor:composer-2.5-fast',
  },
  {
    spec: 'gpt-5.6-sol[reasoning=xhigh,fast=false]',
    model: 'gpt-5.6-sol',
    canonical: 'cursor:gpt-5.6-sol[fast=false,reasoning=xhigh]',
  },
  { spec: 'cursor:auto', model: 'auto', canonical: 'cursor:auto' },
  { spec: 'cursor:gpt-5.2', model: 'gpt-5.2', canonical: 'cursor:gpt-5.2' },
]

test('every pre-existing cursor mapping form resolves exactly as before', () => {
  for (const { spec, model, canonical } of UNCHANGED_SPECS) {
    const mapping = parsePersonaMapping(spec)

    assert.equal(mapping.executor, 'cursor', spec)
    assert.equal(mapping.model, model, spec)
    assert.equal(personaExecutorOf(spec), 'cursor', spec)
    assert.equal(canonicalPersonaMapping(spec), canonical, spec)
  }
})

test('claude-code mappings are untouched by the new prefix', () => {
  const mapping = parsePersonaMapping(
    'claude-code:claude-opus-5[permission-mode=plan,session-resume=true]',
  )

  assert.equal(mapping.executor, 'claude-code')
  assert.equal(mapping.model, 'claude-opus-5')
  assert.deepEqual(mapping.options, {
    'permission-mode': 'plan',
    'session-resume': 'true',
  })
  assert.equal(
    canonicalPersonaMapping(
      'claude-code:claude-opus-5[session-resume=true,permission-mode=plan]',
    ),
    'claude-code:claude-opus-5[permission-mode=plan,session-resume=true]',
  )
})

test('all four alias families expand to the same cursor specs as before', () => {
  const file = parsePipelineConfig({
    schema_version: 1,
    active_config: 'default',
    anthropic: {
      balanced: 'claude-sonnet-5-thinking-medium',
      advanced: 'claude-opus-5-thinking-high-fast',
      ultra: 'claude-fable-5-1-thinking-high',
    },
    oai: {
      balanced: 'gpt-5.5-medium',
      advanced: 'gpt-5.4-high',
      ultra: 'gpt-5.6-sol-high',
    },
    open: {
      balanced: 'kimi-k3-max',
      advanced: 'cursor-grok-4.6-medium-fast',
      ultra: 'kimi-k3-max',
    },
    cursor: {
      balanced: 'composer-2.5-fast',
      advanced: 'composer-2.5-fast',
      ultra: 'composer-2.5-fast',
    },
    configs: {
      default: {
        a: 'anthropic:balanced',
        b: 'oai:advanced',
        c: 'open:ultra',
        d: 'cursor:balanced',
      },
    },
  })

  assert.deepEqual(file.configs.default.personas, {
    a: 'claude-sonnet-5-thinking-medium',
    b: 'gpt-5.4-high',
    c: 'kimi-k3-max',
    d: 'composer-2.5-fast',
  })

  for (const model of Object.values(file.configs.default.personas)) {
    assert.equal(personaExecutorOf(model), 'cursor', model)
  }
})

test('moving a persona to openai prunes its projected cursor subagent', () => {
  const root = createFixture()
  const configPath = path.join(root, 'config.json')
  const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
    defaults: Record<string, string>
    configs?: Record<string, Record<string, unknown>>
  }

  syncCursorProjection(root, { write: true })

  const projected = path.join(root, '.cursor/agents/pan-planner.md')

  assert.ok(existsSync(projected), 'a cursor persona owns a projected agent')

  config.defaults.planner = 'openai:gpt-6-astra[effort=high]'

  for (const named of Object.values(config.configs ?? {})) {
    delete named.planner

    if (typeof named.personas === 'object' && named.personas !== null) {
      delete (named.personas as Record<string, unknown>).planner
    }
  }

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  syncCursorProjection(root, { write: true })

  // An externally executed persona has no Cursor subagent to launch, so a
  // stale one left behind would be a live route to the wrong runtime.
  assert.equal(existsSync(projected), false)

  // The neighbouring cursor personas keep theirs.
  assert.ok(existsSync(path.join(root, '.cursor/agents/pan-coder.md')))
})
