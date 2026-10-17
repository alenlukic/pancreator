/** Executable authority supplied by a plan or a source-authorized handoff. */
export interface VerificationExecutionOperation {
  schema_version: 1
  id: string
  criterion?: string
  finding?: string
  argv: string[]
  cwd: string
  timeout_ms: number
  write_roots: string[]
  evidence_paths: string[]
  /** Omitted means mandatory; optional operations can be selected by id. */
  required?: boolean
}

export interface VerificationExecutionSource {
  path: string
  sha256: string
  invocation_id: string
  authority: 'approved_plan' | 'source_allowed'
}

export interface VerificationExecutionContract {
  schema_version: 1
  manifest_path: string
  /** Workspace-relative ceiling. Operation roots can only narrow it. */
  write_root: string
  sources: VerificationExecutionSource[]
  operations: {
    operation: VerificationExecutionOperation
    source: VerificationExecutionSource
    case_id?: string
  }[]
  gaps: { id: string; reason: string }[]
}

/** Raw observations, never a QA or browser verdict. */
export interface VerificationExecutionEvidence {
  schema_version: 1
  run_id: string
  invocation_id: string
  attempt: number
  operation_id: string
  definition_sha256: string
  source_fingerprint: string | null
  source: VerificationExecutionSource
  argv: string[]
  cwd: string
  timeout_ms: number
  write_roots: string[]
  evidence_paths: string[]
  started_at: string
  ended_at: string
  duration_ms: number
  exit_code: number | null
  signal: string | null
  timed_out: boolean
  status: 'collected' | 'failed' | 'gap'
  error?: string
  stdout: string
  stderr: string
  observations: { path: string; content: string; sha256: string }[]
  enforcement: {
    mode: string
    reason: string
    /** Absent on legacy records, which must be recollected before passing. */
    processes?: 'single-process' | 'unverified'
  }
}

export interface VerificationExecutionManifest {
  schema_version: 1
  run_id: string
  invocation_id: string
  attempt: number
  source_fingerprint: string | null
  records: VerificationExecutionEvidence[]
  gaps: { id: string; reason: string }[]
  /** Preserves failed and superseded collections instead of relabeling them. */
  history: VerificationExecutionEvidence[]
}
