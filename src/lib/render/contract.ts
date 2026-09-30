/**
 * Invocation contract blocks: the section split of a rendered card and the
 * contract manifest built from it.
 */

import { sha256 } from '../io.js'
import type {
  InvocationContractSectionOwner,
  Policy,
  InvocationContractGuidance,
  InvocationContractManifest,
} from '../types.js'
import { DELEGATION_HEADING } from '../validation/artifacts.js'
import { normalizeContractMarkdown } from '../validation/attestation.js'

/**
 * Returns the value as pretty-printed JSON inside a fenced Markdown `json` code
 * block.
 */
export function fencedJson(value: unknown): string {
  return ['```json', JSON.stringify(value, null, 2), '```'].join('\n')
}

/** Longest section-id slug retained from a heading, so ids stay readable. */
const SECTION_SLUG_MAX_LENGTH = 48

const TOP_LEVEL_HEADING_PATTERN = /^## /u

/**
 * One top-level block of a canonical worker contract. Concatenating every
 * block's `markdown` reproduces the contract byte for byte, which is what lets a
 * section digest and the whole-file digest be checked against the same file.
 */
export interface InvocationContractBlock {
  id: string
  heading: string
  owner: InvocationContractSectionOwner
  markdown: string
  line_count: number
}

function sectionSlug(heading: string): string {
  const slug = heading
    .replace(/^#+\s*/u, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-+|-+$/gu, '')
    .slice(0, SECTION_SLUG_MAX_LENGTH)
    .replaceAll(/-+$/gu, '')

  return slug.length > 0 ? slug : 'section'
}

function sectionId(index: number, heading: string): string {
  return `${String(index + 1).padStart(3, '0')}-${sectionSlug(heading)}`
}

/**
 * Split a rendered contract into ordered top-level blocks.
 *
 * Content before the first `## ` heading forms a preamble block. The supervisor
 * delivery procedure is appended last, so every block from that heading onward
 * is supervisor-owned and the rest binds the worker.
 */
export function splitInvocationContract(
  markdown: string,
): InvocationContractBlock[] {
  const lines = normalizeContractMarkdown(markdown).slice(0, -1).split('\n')
  const groups: Array<{ heading: string; lines: string[] }> = []

  for (const line of lines) {
    if (groups.length === 0 || TOP_LEVEL_HEADING_PATTERN.test(line)) {
      groups.push({
        heading: TOP_LEVEL_HEADING_PATTERN.test(line)
          ? line.trim()
          : 'Preamble',
        lines: [],
      })
    }

    groups[groups.length - 1]?.lines.push(line)
  }

  const supervisorIndex = groups.findIndex(
    (group) => group.heading === DELEGATION_HEADING,
  )

  return groups.map((group, index) => ({
    id: sectionId(index, group.heading),
    heading: group.heading,
    owner:
      supervisorIndex !== -1 && index >= supervisorIndex
        ? ('supervisor' as const)
        : ('worker' as const),
    markdown: `${group.lines.join('\n')}\n`,
    line_count: group.lines.length,
  }))
}

/**
 * Name every referenced guidance selection the contract points at, in policy
 * order. Legacy inline guidance carries its body on the card, so a read needs
 * no attestation and it is not listed.
 */
function manifestGuidance(policies: Policy[]): InvocationContractGuidance[] {
  return policies.flatMap((policy) =>
    (policy.guidance ?? []).flatMap((guidance) =>
      guidance.reference
        ? [
            {
              policy_id: policy.id,
              source_path: guidance.source_path,
              content_sha256: guidance.reference.content_sha256,
              read_trigger: guidance.reference.read_trigger,
            },
          ]
        : [],
    ),
  )
}

/** Describe a rendered contract as a flat, digest-bearing section index. */
export function buildInvocationContractManifest(
  contractPath: string,
  markdown: string,
  policies: Policy[] = [],
): InvocationContractManifest {
  const contract = normalizeContractMarkdown(markdown)
  const blocks = splitInvocationContract(contract)
  const guidance = manifestGuidance(policies)

  return {
    contract_path: contractPath,
    contract_sha256: sha256(contract),
    byte_length: Buffer.byteLength(contract, 'utf8'),
    line_count: contract.slice(0, -1).split('\n').length,
    sections: blocks.map((block) => ({
      id: block.id,
      heading: block.heading,
      owner: block.owner,
      line_count: block.line_count,
      sha256: sha256(block.markdown),
    })),
    ...(guidance.length > 0 ? { guidance } : {}),
  }
}
