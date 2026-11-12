import assert from 'node:assert/strict'
import test from 'node:test'

import { workflowSupportsDesignComposition } from '../../src/lib/design-composition.js'
import { prepareInvocation } from '../../src/lib/engine.js'
import { listWorkflowSlugs, loadWorkflow } from '../../src/lib/workflow.js'
import { createFixture } from '../helpers.js'
import { createRun } from '../run-helpers.js'

function failureText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

test('every installed workflow prepares its start stage', () => {
  const root = createFixture()
  const failures: string[] = []

  for (const slug of listWorkflowSlugs(root)) {
    const workflow = loadWorkflow(root, slug)
    const variants = workflowSupportsDesignComposition(workflow)
      ? [
          { label: slug, design: false },
          { label: `${slug} with design`, design: true },
        ]
      : [{ label: slug, design: false }]

    for (const variant of variants) {
      try {
        const state = createRun(root, {
          workflowSlug: slug,
          requestPath: 'request.md',
          title: variant.label,
          ...(variant.design ? { design: true } : {}),
        })
        const prepared = prepareInvocation(root, state.run_id)
        const invocation = prepared.invocation

        assert.ok(invocation, `${variant.label} produced no invocation`)
        assert.equal(invocation.stage.slug, state.current_stage)
        assert.equal(invocation.workflow.slug, slug)

        if (slug === 'one-shot' && invocation.stage.slug === 'implement') {
          assert.ok(
            invocation.output.field_contract?.validators.some(
              (validator) =>
                validator.registry_id === 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
            ),
            'one-shot implement must resolve its claims validator',
          )
        }
      } catch (error) {
        failures.push(`${variant.label}: ${failureText(error)}`)
      }
    }
  }

  assert.deepEqual(failures, [])
})
