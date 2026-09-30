import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { createTestTempDirectory } from '../temp.js'

/**
 * Bare validator fixture root carrying the shared field-contract document.
 * Validators read the document from the installation root only; production
 * code deliberately has no fallback to the checkout that started the run,
 * so each fixture ships its own copy.
 */
export function installFieldContract(root: string): void {
  const contractRelative = 'library/schemas/stage-output-requirements.json'

  mkdirSync(path.join(root, 'library/schemas'), { recursive: true })
  writeFileSync(
    path.join(root, contractRelative),
    readFileSync(path.join(process.cwd(), contractRelative)),
  )
}

export function validatorFixtureRoot(prefix: string): string {
  const root = createTestTempDirectory(prefix)

  installFieldContract(root)

  return root
}

export function writePlanOutput(
  root: string,
  runId: string,
  criterionIds: string[],
  planAttempt = 1,
): void {
  const outputsDir = path.join(root, 'runtime/logs/workflows', runId, 'outputs')

  mkdirSync(outputsDir, { recursive: true })
  writeFileSync(
    path.join(outputsDir, `plan-${planAttempt}-test.json`),
    `${JSON.stringify({
      data: {
        acceptance_criteria: criterionIds.map((id) => ({ id })),
      },
    })}\n`,
  )
}

export function verifyRequirement() {
  return {
    policy_id: 'VERIFY-001',
    requirement_id: 'verify',
    registry_id: 'VERIFY-VALIDATE-001',
    arguments: {},
  }
}

export function writeVerifyOutput(
  root: string,
  target: string,
  verify: Record<string, unknown>,
  result = 'success',
): void {
  const absolute = path.join(root, target)

  mkdirSync(path.dirname(absolute), { recursive: true })
  writeFileSync(absolute, `${JSON.stringify({ result, data: { verify } })}\n`)
}

export const passingQaCase = {
  id: 'TP-01',
  steps: 'Run the fixture',
  expected: 'advance',
  actual: 'advance',
  result: 'pass',
}

export function claimsValidatorInput(
  root: string,
  target: string,
  invocation?: Record<string, unknown>,
) {
  return {
    root,
    targetPath: target,
    requirement: {
      policy_id: 'DEV-001',
      requirement_id: 'implementation-claims',
      registry_id: 'IMPLEMENTATION-CLAIMS-VALIDATE-001',
      arguments: {},
    },
    ...(invocation ? { invocation } : {}),
  }
}
