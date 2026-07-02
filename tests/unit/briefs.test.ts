import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  buildBriefSystem,
  renderBrief,
  validateBriefSystem,
} from '../../src/lib/briefs.js'
import { createFixture, writeJson } from '../helpers.js'

test('Pancreator self-development brief system validates', () => {
  const result = validateBriefSystem(process.cwd())

  assert.equal(result.status, 'passed', result.errors.join('\n'))
})

test('brief system build creates a target-specific project layer without shared overrides', () => {
  const root = createFixture()
  const projectDirectory = path.join(root, 'docs', 'operator-briefs')

  rmSync(projectDirectory, { recursive: true, force: true })

  const result = buildBriefSystem(root)

  assert.equal(result.status, 'built')
  assert.deepEqual(result.created.sort(), [
    'docs/operator-briefs/project.css',
    'docs/operator-briefs/project.json',
  ])
  assert.equal(validateBriefSystem(root).status, 'passed')

  const registry = JSON.parse(
    readFileSync(path.join(projectDirectory, 'project.json'), 'utf8'),
  ) as { project: { id: string; title: string } }

  assert.ok(registry.project.id.length > 0)
  assert.ok(registry.project.title.length > 0)
  assert.equal(buildBriefSystem(root).status, 'unchanged')
})

test('brief renderer writes self-contained semantic HTML', () => {
  const root = createFixture()
  const input = 'runtime/example-brief.json'
  const output = 'runtime/example-brief.html'

  mkdirSync(path.join(root, 'runtime'), { recursive: true })
  writeJson(path.join(root, input), {
    schema_version: 1,
    brief_type: 'general',
    title: 'Implementation result',
    sections: [
      {
        semantic: 'executive-summary',
        title: 'Executive summary',
        cards: [
          {
            type: 'summary',
            title: 'The requested change is complete',
            lede: 'The operator can review the validated result and proceed.',
            fields: [
              {
                label: 'Status',
                value: 'Ready',
                semantic: 'status',
                placement: 'meta',
              },
            ],
            actions: [
              {
                label: 'Review result',
                href: '#changes',
                style: 'primary',
              },
            ],
          },
        ],
      },
      {
        semantic: 'changes',
        title: 'Changes',
        cards: [
          {
            type: 'summary',
            title: 'Semantic HTML output',
            body: 'Data and presentation are separated.',
          },
        ],
      },
    ],
  })

  const result = renderBrief(root, input, output)
  const html = readFileSync(path.join(root, output), 'utf8')

  assert.equal(result.status, 'rendered')
  assert.equal(result.cards, 2)
  assert.match(html, /^<!doctype html>/u)
  assert.match(html, /class="pc-brief"/u)
  assert.match(html, /data-section-semantic="executive-summary"/u)
  assert.match(html, /🧭/u)
  assert.match(html, /--pc-accent/u)
  assert.doesNotMatch(html, /<link\b/iu)
  assert.doesNotMatch(html, /<script\b/iu)
})

test('brief renderer rejects missing executive summary and active HTML', () => {
  const root = createFixture()
  const input = 'runtime/invalid-brief.json'

  writeJson(path.join(root, input), {
    schema_version: 1,
    brief_type: 'general',
    title: 'Invalid brief',
    sections: [
      {
        semantic: 'changes',
        title: 'Changes',
        cards: [
          {
            type: 'summary',
            title: 'Unsafe content',
            body_html: '<script>alert(1)</script>',
          },
        ],
      },
    ],
  })

  assert.throws(
    () => renderBrief(root, input, 'runtime/invalid.html'),
    /executive-summary|active or unsafe HTML/u,
  )
})

test('brief system rejects semantic collisions and duplicate emoji meanings', () => {
  const root = createFixture()
  const registryPath = path.join(
    root,
    'docs',
    'operator-briefs',
    'project.json',
  )
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Record<
    string,
    unknown
  >

  registry.section_semantics = {
    changes: {
      emoji: '🧭',
      label: 'Duplicate changes',
      description: 'Invalid override.',
    },
    custom: {
      emoji: '🧭',
      label: 'Custom',
      description: 'Invalid duplicate emoji.',
    },
  }
  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`)

  const result = validateBriefSystem(root)

  assert.equal(result.status, 'failed')
  assert.ok(result.errors.some((error) => error.includes('collides')))
  assert.ok(result.errors.some((error) => error.includes('assigned to both')))
})
