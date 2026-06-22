export class PanError extends Error {
  constructor(message, { code = "PAN_ERROR", details = undefined, exitCode = 1 } = {}) {
    super(message);
    this.name = "PanError";
    this.code = code;
    this.details = details;
    this.exitCode = exitCode;
  }
}

export function invariant(condition, message, options = {}) {
  if (!condition) {
    throw new PanError(message, options);
  }
}
