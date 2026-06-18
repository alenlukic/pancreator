export class InvalidAutomationIdError extends Error {
  readonly name = "InvalidAutomationIdError";
  constructor(message: string) {
    super(message);
  }
}

export class AutomationPathError extends Error {
  readonly name = "AutomationPathError";
  constructor(message: string) {
    super(message);
  }
}

export class AutomationValidationError extends Error {
  readonly name = "AutomationValidationError";
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join("; "));
    this.errors = errors;
  }
}

export class AutomationNotFoundError extends Error {
  readonly name = "AutomationNotFoundError";
  constructor(message: string) {
    super(message);
  }
}

export class SchedulerPathError extends Error {
  readonly name = "SchedulerPathError";
  constructor(message: string) {
    super(message);
  }
}
