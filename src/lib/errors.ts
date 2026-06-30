export interface PanErrorOptions {
  code?: string
  details?: unknown
  exitCode?: number
}

export class PanError extends Error {
  readonly code: string
  readonly details: unknown
  readonly exitCode: number

  constructor(message: string, options: PanErrorOptions = {}) {
    super(message)
    this.name = 'PanError'
    this.code = options.code ?? 'PAN_ERROR'
    this.details = options.details
    this.exitCode = options.exitCode ?? 1
  }
}

export function invariant(
  condition: unknown,
  message: string,
  options: PanErrorOptions = {},
): asserts condition {
  if (!condition) {
    throw new PanError(message, options)
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
