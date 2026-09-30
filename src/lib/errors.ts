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

/**
 * Asserts a condition, throwing a `PanError` with the message and options
 * (code defaults to `PAN_ERROR`) when it is falsy.
 */
export function invariant(
  condition: unknown,
  message: string,
  options: PanErrorOptions = {},
): asserts condition {
  if (!condition) {
    throw new PanError(message, options)
  }
}

/** Message of an `Error`, or the value converted to a string. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Type guard: true for an `Error` carrying a `code` property, as Node system errors do. */
export function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
