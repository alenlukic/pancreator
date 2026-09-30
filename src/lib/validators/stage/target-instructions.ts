/** Target instruction read coverage for source-changing stages. */

import path from 'node:path'

import {
  isRecord,
  readJson,
  fileExists,
  lastEvidenceLine,
  readText,
} from '../../io.js'
import type { HandlerInput, HandlerResult } from '../../requirements/types.js'
import { resolveTargetInstructionPaths } from '../../target-instructions.js'
import {
  gitUnavailableIssue,
  issue,
  workspaceRootFromInput,
  workspaceSourceChanges,
} from './evidence.js'

/** Validate AGENTS.md read evidence against declared and final changed paths. */
export function validateTargetInstructionCoverage(
  input: HandlerInput,
): HandlerResult {
  const issues: HandlerResult['issues'] = []
  const invocationInputs =
    isRecord(input.invocation) && isRecord(input.invocation.inputs)
      ? input.invocation.inputs
      : null
  const targetInstructions =
    invocationInputs && isRecord(invocationInputs.target_instructions)
      ? invocationInputs.target_instructions
      : null

  if (!targetInstructions) {
    return {
      status: 'failed',
      issues: [
        issue(
          'TARGET_INSTRUCTION_COVERAGE_MISSING',
          'The invocation does not declare target instruction paths.',
        ),
      ],
    }
  }

  const declaredChangedPaths = Array.isArray(targetInstructions.changed_paths)
    ? targetInstructions.changed_paths.filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  const invocationReadPaths = Array.isArray(targetInstructions.read_paths)
    ? targetInstructions.read_paths.filter(
        (item): item is string => typeof item === 'string',
      )
    : []
  const workspaceRoot = workspaceRootFromInput(input)

  const output = readJson(path.join(input.root, input.targetPath))
  const outputData =
    isRecord(output) && isRecord(output.data) ? output.data : null
  const implementation =
    outputData && isRecord(outputData.implementation)
      ? outputData.implementation
      : null
  const claimedChangedPaths =
    implementation && Array.isArray(implementation.changed_files)
      ? implementation.changed_files.filter(
          (item): item is string => typeof item === 'string',
        )
      : []

  const diff = workspaceSourceChanges(workspaceRoot)
  const workspaceBefore =
    isRecord(input.invocation) && isRecord(input.invocation.workspace_before)
      ? input.invocation.workspace_before
      : null

  if (!diff.ok && workspaceBefore?.kind !== 'filesystem') {
    issues.push(gitUnavailableIssue(diff.error))
  }

  const finalChangedPaths = [
    ...new Set([
      ...declaredChangedPaths,
      ...claimedChangedPaths,
      ...(diff.ok ? diff.files : []),
    ]),
  ].sort()
  const finalReadPaths = resolveTargetInstructionPaths(
    workspaceRoot,
    finalChangedPaths,
  )
  const requiredReadPaths = [
    ...new Set([...invocationReadPaths, ...finalReadPaths]),
  ].sort()

  const evidence =
    isRecord(output) && isRecord(output.target_instruction_evidence)
      ? output.target_instruction_evidence
      : null
  const readPaths =
    evidence && Array.isArray(evidence.read_paths)
      ? evidence.read_paths.filter(
          (item): item is string => typeof item === 'string',
        )
      : []
  const reads = new Map<string, string>(
    evidence && Array.isArray(evidence.reads)
      ? evidence.reads.flatMap(
          (entry): Array<[string, string]> =>
            isRecord(entry) &&
            typeof entry.path === 'string' &&
            typeof entry.final_line === 'string'
              ? [[entry.path, entry.final_line]]
              : [],
        )
      : [],
  )

  for (const requiredPath of requiredReadPaths) {
    if (!readPaths.includes(requiredPath)) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_COVERAGE_MISSING',
          `Target instruction evidence omits ${requiredPath}.`,
        ),
      )
      continue
    }

    // A path list alone is copyable from the card; the quoted closing line is
    // what shows the file was opened. It validates against the workspace file
    // because instruction files bind as they exist in the tree being changed.
    const declaredFinalLine = reads.get(requiredPath)

    if (declaredFinalLine === undefined) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_READ_EVIDENCE_MISSING',
          `Target instruction evidence MUST include reads entry ` +
            `{ path, final_line } quoting the last content line of ` +
            `${requiredPath}.`,
        ),
      )
      continue
    }

    const instructionAbsolute = path.join(workspaceRoot, requiredPath)

    if (!fileExists(instructionAbsolute)) {
      continue
    }

    const expectedFinalLine = lastEvidenceLine(readText(instructionAbsolute))

    if (declaredFinalLine.trim() !== expectedFinalLine.trim()) {
      issues.push(
        issue(
          'TARGET_INSTRUCTION_READ_EVIDENCE_MISMATCH',
          `Target instruction read evidence for ${requiredPath} does not ` +
            `quote the file's last content line (trailing divider lines ` +
            `are skipped).`,
        ),
      )
    }
  }

  return { status: issues.length === 0 ? 'passed' : 'failed', issues }
}
