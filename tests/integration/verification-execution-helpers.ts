import type { VerificationExecutionOperation } from '../../src/lib/types/verification-execution.js'

export function operation(
  id: string,
  code: string,
  extra: Partial<VerificationExecutionOperation> = {},
): VerificationExecutionOperation {
  return {
    schema_version: 1,
    id,
    criterion: 'AC-01',
    argv: [process.execPath, '-e', code],
    cwd: '.',
    timeout_ms: 3000,
    write_roots: [`runtime/verification-execution/${id}`],
    evidence_paths: [],
    ...extra,
  }
}
