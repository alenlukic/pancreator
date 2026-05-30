export class InvalidTaskIdForJournalError extends Error {
  readonly name = "InvalidTaskIdForJournalError";
  constructor(message: string) {
    super(message);
  }
}

export class InterventionJournalPathError extends Error {
  readonly name = "InterventionJournalPathError";
  constructor(message: string) {
    super(message);
  }
}

export class MalformedJournalLineError extends Error {
  readonly name = "MalformedJournalLineError";
  constructor(message: string) {
    super(message);
  }
}
