import path from 'node:path'

import { readJson } from '../io.js'
import type { HandlerInput, HandlerResult } from '../requirements/types.js'
import { validateTuneRecordShape } from '../test-tuning.js'

function issue(code: string, message: string) {
  return { code, message }
}

export function validateTuneRecord(input: HandlerInput): HandlerResult {
  const absolute = path.isAbsolute(input.targetPath)
    ? input.targetPath
    : path.join(input.root, input.targetPath)
  const record = readJson(absolute)
  const errors = validateTuneRecordShape(record, input.root)

  return {
    status: errors.length === 0 ? 'passed' : 'failed',
    issues: errors.map((message) => issue('tune-record.invalid', message)),
  }
}

export { validateTuneRecordShape }
