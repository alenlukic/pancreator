import type { Facility, FacilityCategory } from './inventory.js'
import type { FacilityUsage, UsageScanSources } from './usage.js'
import type { CandidateAssessment } from './adjudication.js'
import type { CandidatePreview } from './closure.js'
import type { OrphanFinding } from './orphans.js'

export interface ReportInput {
  sessionId: string
  windowDays: number
  windowStart: string
  generatedAt: string
  worktree: string | null
  sources: UsageScanSources
  facilities: readonly Facility[]
  usage: readonly FacilityUsage[]
  candidates: readonly string[]
  assessments: readonly CandidateAssessment[]
  previews: readonly CandidatePreview[]
  orphanFindings: readonly OrphanFinding[]
  protectedCandidates: readonly string[]
}

const CATEGORY_ORDER: FacilityCategory[] = [
  'command',
  'mode',
  'persona',
  'workflow',
  'orphan',
  'skill',
  'policy',
  'handbook',
  'template',
  'validator',
]

/**
 * What a category's absence from the run records is worth. A category the
 * harness records by name produces a strong claim when it is missing. A
 * category that leaves no record produces a weaker one, and the operator has
 * to see which kind a row is before deciding to remove it.
 */
const CATEGORY_CONFIDENCE: Record<FacilityCategory, string> = {
  'artifact-profile': 'structural: derived graph node',
  'cli-subcommand': 'structural: derived graph node',
  command: 'strong: Cursor command markers and session directories name it',
  criterion: 'structural: derived graph node',
  handbook: 'medium: recorded only when a policy binds it as guidance',
  invocation: 'structural: derived graph node',
  mode: 'strong: every standalone session writes its mode card',
  orphan:
    'medium: no module, barrel consumer, tracked script, or string literal ' +
    'names it, and a path assembled at run time can still hide a consumer',
  persona: 'strong: every invocation records its stage persona',
  policy: 'strong: every invocation records its resolved policies',
  requirement: 'structural: derived graph node',
  skill: 'medium: recorded only when a policy binds it as guidance',
  'source-symbol': 'structural: derived graph node',
  template: 'weak: no runtime record exists, so only prose and edges count',
  validator: 'weak: no runtime record exists, so only prose and edges count',
  workflow: 'strong: every run records its workflow slug',
}

function escapeCell(value: string): string {
  return value.replace(/\|/gu, '\\|')
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

/**
 * Operator-facing scan report.
 *
 * Confidence sits in its own column because it changes what the operator
 * should conclude from a row: an unused template rests on weaker evidence
 * than an unused persona even when both show nothing at all.
 */
export function renderScanReport(input: ReportInput): string {
  const byId = new Map(input.facilities.map((entry) => [entry.id, entry]))
  const assessmentById = new Map(
    input.assessments.map((entry) => [entry.facility_id, entry]),
  )
  const previewById = new Map(
    input.previews.map((entry) => [entry.facility_id, entry]),
  )
  const lines: string[] = []

  lines.push(`# Debloat scan ${input.sessionId}`)
  lines.push('')
  lines.push(
    `Window: last ${plural(input.windowDays, 'day')}, from ` +
      `${input.windowStart} to ${input.generatedAt}.`,
  )
  lines.push('')
  lines.push(
    `Workspace: ${
      input.worktree ? `worktree \`${input.worktree}\`` : 'installation root'
    }.`,
  )
  lines.push('')
  lines.push(
    `Evidence read: ${plural(input.sources.workflow_runs, 'workflow run')}, ` +
      `${plural(input.sources.sessions, 'standalone session')}, ` +
      `${plural(input.sources.command_invocations, 'command invocation')}, ` +
      `${plural(input.sources.transcript_files, 'transcript file')}, ` +
      `${plural(input.sources.operator_request_files, 'operator request')}.`,
  )
  lines.push('')
  lines.push(
    `Agent evidence: ${plural(input.sources.agent_invocations, 'agent invocation')} ` +
      `and ${plural(input.sources.agent_lookups, 'agent lookup')} counted. ` +
      `${plural(input.sources.incidental_mentions, 'incidental mention')} ignored. ` +
      `${plural(input.sources.debloat_sessions_excluded, 'debloat session transcript')} excluded.`,
  )
  lines.push('')
  lines.push('Coverage by source:')

  for (const [source, count] of Object.entries(
    input.sources.by_source,
  ).sort()) {
    lines.push(`- ${source}: ${count}`)
  }

  lines.push(
    `- unread: ${
      input.sources.unread.length === 0
        ? 'none'
        : input.sources.unread.map((entry) => `\`${entry}\``).join(', ')
    }`,
  )

  if (!input.sources.transcripts_root) {
    lines.push('')
    lines.push(
      'No transcript directory was found, so no command invocation or ' +
        'operator prose evidence entered this scan. Treat every candidate ' +
        'below as less certain than a normal run.',
    )
  }

  lines.push('')
  lines.push(
    'A facility is a candidate only when no run record names it, no ' +
      'executed facility still references it, and no functional direction ' +
      'in chat or an inbox request names it. A question, a pasted report, ' +
      'an index entry, and a debloat session never retain a facility.',
  )
  lines.push('')
  lines.push(
    `Facilities inventoried: ${input.facilities.length}. ` +
      `Unused candidates: ${input.candidates.length}.`,
  )
  lines.push('')
  lines.push('## Unused candidates')

  if (input.candidates.length === 0) {
    lines.push('')
    lines.push('No facility went unused for the whole window.')
  }

  for (const category of CATEGORY_ORDER) {
    const rows = input.candidates
      .map((id) => byId.get(id))
      .filter(
        (entry): entry is Facility =>
          entry !== undefined && entry.category === category,
      )

    if (rows.length === 0) {
      continue
    }

    lines.push('')
    lines.push(`### ${category} (${rows.length})`)
    lines.push('')
    lines.push(
      `Confidence for this category is ${CATEGORY_CONFIDENCE[category]}.`,
    )
    lines.push('')
    lines.push(
      '| Facility | Definition | Only its own tests reference it | Deterministic result | Agentic adjudication | Selection frees |',
    )
    lines.push('| --- | --- | --- | --- | --- | --- |')

    for (const entry of rows) {
      const preview = previewById.get(entry.id)
      const freed = [
        ...(preview?.cascaded ?? []),
        ...(preview?.freed.map((item) =>
          item.symbol ? `${item.path}#${item.symbol}` : item.path,
        ) ?? []),
      ]

      lines.push(
        `| \`${escapeCell(entry.id)}\` | ` +
          `${entry.path ? `\`${escapeCell(entry.path)}\`` : 'code-resident'} | ` +
          `${input.usage.find((usage) => usage.facility_id === entry.id)?.test_only_references ? 'yes' : 'no'} | ` +
          `${assessmentById.get(entry.id)?.deterministic_verdict ?? 'unknown'} | ` +
          `${
            assessmentById.get(entry.id)?.deterministic_verdict === 'unclear'
              ? 'required before selection'
              : 'not required'
          } | ${escapeCell(freed.join(', ') || 'nothing')} |`,
      )
    }
  }

  if (input.orphanFindings.length > 0) {
    lines.push('')
    lines.push('## Independent orphan check')
    lines.push('')
    lines.push('| Candidate | Kind | Source |')
    lines.push('| --- | --- | --- |')

    for (const finding of input.orphanFindings) {
      lines.push(
        `| \`${escapeCell(finding.id)}\` | ${finding.kind} | ` +
          `\`${escapeCell(
            finding.symbol ? `${finding.path}#${finding.symbol}` : finding.path,
          )}\` |`,
      )
    }
  }

  // A facility whose only structural references are its own tests is held up
  // by the tests written to exercise it. When such a facility also stayed off
  // the candidate list on weaker evidence, only the operator can tell whether
  // that evidence was a real use or a direction that never ran.
  const testOnlySurvivors = input.usage
    .filter(
      (entry) =>
        entry.test_only_references &&
        entry.evidence_tier !== 'execution' &&
        !input.candidates.includes(entry.facility_id),
    )
    .sort((left, right) => left.facility_id.localeCompare(right.facility_id))

  if (testOnlySurvivors.length > 0) {
    lines.push('')
    lines.push('## Kept off the list, but only their own tests use them')
    lines.push('')
    lines.push(
      'Nothing in the harness reaches these. Their only references are the ' +
        'tests written to exercise them, so those tests show that the code ' +
        'runs rather than that anything needs it. Each one stayed off the ' +
        'candidate list on the weaker evidence named below. Review them.',
    )
    lines.push('')
    lines.push('| Facility | Why it is not a candidate |')
    lines.push('| --- | --- |')

    for (const entry of testOnlySurvivors) {
      lines.push(
        `| \`${escapeCell(entry.facility_id)}\` | ` +
          `${
            entry.evidence_tier === 'direction'
              ? 'a direction in chat or an inbox request named it inside the window'
              : `depended on by ${escapeCell(
                  entry.depended_on_by.join(', ') || 'an indirect chain',
                )}`
          } |`,
      )
    }
  }

  const reachableOnly = input.usage
    .filter((entry) => entry.evidence_tier === 'reachable')
    .sort((left, right) => left.facility_id.localeCompare(right.facility_id))

  if (reachableOnly.length > 0) {
    lines.push('')
    lines.push('## Idle but depended upon')
    lines.push('')
    lines.push(
      'No run record named these, but harness code or a facility that did ' +
        'run still references them. Removing one means removing its ' +
        'dependent too, so they are not offered as candidates.',
    )
    lines.push('')
    lines.push('| Facility | Depended on by |')
    lines.push('| --- | --- |')

    for (const entry of reachableOnly) {
      lines.push(
        `| \`${escapeCell(entry.facility_id)}\` | ` +
          `${escapeCell(
            entry.depended_on_by.join(', ') ||
              'an indirect chain of idle facilities',
          )} |`,
      )
    }
  }

  if (input.protectedCandidates.length > 0) {
    lines.push('')
    lines.push('## Unused but protected')
    lines.push('')
    lines.push(
      'These showed no evidence and cannot be removed. Each one is part of ' +
        'the bootstrap a later repair would need.',
    )
    lines.push('')
    lines.push('| Facility | Reason |')
    lines.push('| --- | --- |')

    for (const id of input.protectedCandidates) {
      lines.push(
        `| \`${escapeCell(id)}\` | ` +
          `${escapeCell(byId.get(id)?.protected_reason ?? 'Protected.')} |`,
      )
    }
  }

  lines.push('')
  lines.push('## Next step')
  lines.push('')
  lines.push(
    'Record an agentic verdict for every unclear candidate with ' +
      `\`pan debloat adjudicate --session ${input.sessionId} ` +
      '--facility <id> --verdict <remove|keep> --reason <text> ' +
      '--evidence <reference>`.',
  )
  lines.push('')
  lines.push(
    'Choose the subset to remove, then record one or more ids with ' +
      `\`pan debloat select --session ${input.sessionId} --facility <id>\`. ` +
      'Selections accumulate; pass `--replace` to reset the recorded set.',
  )
  lines.push('')

  // The usage table is referenced from candidates.json rather than printed,
  // because a 200-row table buries the short list the operator acts on.
  lines.push(
    'Per-facility evidence for every inventoried facility, including the ' +
      'ones this report does not list, is in `candidates.json` under `usage`.',
  )
  lines.push('')

  return lines.join('\n')
}
