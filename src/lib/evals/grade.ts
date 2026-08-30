import path from 'node:path'

import { ensureDir, writeJsonAtomic, writeTextAtomic } from '../io.js'
import { runGrader } from './graders.js'
import { loadRunRecords } from './run-records.js'
import { loadEvalScenario } from './scenario.js'
import type { EvalReport, LoadedEvalScenario } from './types.js'

export function gradeRunRecords(
  root: string,
  runId: string,
  loaded: LoadedEvalScenario,
): EvalReport {
  const records = loadRunRecords(root, runId)
  const graders = loaded.scenario.graders.map((spec) =>
    runGrader({ records, scenario: loaded.scenario, spec }),
  )

  return {
    schema_version: 1,
    scenario: loaded.scenario.name,
    scenario_path: loaded.path,
    run_id: runId,
    run_status: records.state.status,
    current_stage: records.state.current_stage,
    graded_at: new Date().toISOString(),
    passed: graders.every((verdict) => verdict.passed),
    policy_instructions: loaded.scenario.policy_instructions,
    graders,
  }
}

export function gradeEvalRun(
  root: string,
  runId: string,
  scenarioName: string,
): EvalReport {
  return gradeRunRecords(root, runId, loadEvalScenario(root, scenarioName))
}

/** STE-style operator report: short sentences, one fact per line. */
export function renderEvalReportMarkdown(report: EvalReport): string {
  const lines: string[] = [
    `# Eval report: ${report.scenario}`,
    '',
    `**Result:** ${report.passed ? 'PASS' : 'FAIL'}`,
    '',
    `**Run:** \`${report.run_id}\``,
    '',
    `**Run status:** \`${report.run_status}\` at stage \`${String(report.current_stage)}\`.`,
    '',
    `**Graded at:** ${report.graded_at}`,
    '',
    `**Scenario file:** \`${report.scenario_path}\``,
    '',
    '## Policy instructions exercised',
    '',
  ]

  for (const item of report.policy_instructions) {
    lines.push(
      `- \`${item.policy_id}\` instruction ${item.instruction}: ${item.summary}`,
    )
  }

  lines.push('', '## Grader verdicts', '')

  for (const verdict of report.graders) {
    lines.push(
      `### ${verdict.passed ? 'PASS' : 'FAIL'}: ${verdict.id}`,
      '',
      `Policy: ${verdict.policy ? `\`${verdict.policy}\`` : 'none'}.`,
      '',
      verdict.summary,
      '',
    )

    if (verdict.evidence.length > 0) {
      lines.push('Evidence:', '')

      for (const item of verdict.evidence) {
        lines.push(`- \`${item}\``)
      }

      lines.push('')
    } else {
      lines.push('Evidence: none.', '')
    }

    lines.push(`Observability: ${verdict.observability}`, '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

export interface WrittenEvalReport {
  json_path: string
  markdown_path: string
}

export function writeEvalReport(
  root: string,
  directory: string,
  report: EvalReport,
): WrittenEvalReport {
  const absolute = path.resolve(root, directory)

  ensureDir(absolute)

  const jsonPath = path.join(absolute, 'report.json')
  const markdownPath = path.join(absolute, 'report.md')

  writeJsonAtomic(jsonPath, report)
  writeTextAtomic(markdownPath, renderEvalReportMarkdown(report))

  return {
    json_path: path.relative(root, jsonPath).split(path.sep).join('/'),
    markdown_path: path.relative(root, markdownPath).split(path.sep).join('/'),
  }
}
