import {
  commandFailureDiagnostics,
  type RepositoryCheckCommandResult,
  type RepositoryCheckResult,
} from './repository-checks.js'
import type { KnownFailingTest } from './types.js'

/** Heading that opens the declaration block in a run request. */
const SECTION_HEADING = /^#{1,6}\s+known[- ]failing tests\s*$/iu
const NEXT_HEADING = /^#{1,6}\s+/u
const LIST_ITEM = /^\s*[-*]\s+(.*)$/u

/**
 * Separator between the file a test lives in and the case inside it. A
 * declaration that carries neither names a file rather than a test, and a file
 * would credit every failure the file ever produces.
 */
const CASE_SEPARATORS = [' > ', '::', ' :: ']

/** Separator between the declared test and the reason it is expected to fail. */
const REASON_SEPARATORS = [' — ', ' -- ', ' – ']

/**
 * Shapes that head a test failure in the transcripts the configured runners
 * produce. Only a headline can be credited or counted, which is what keeps the
 * error and stack lines printed beneath one from registering as separate
 * undeclared diagnostics.
 */
const FAILURE_HEADLINE_PATTERNS = [
  // vitest and jest: `FAIL test/x.test.ts > names it` and the `×` summary row.
  /(?:^|\s)(?:FAIL|×|✕|✗)\s+\S+/u,
  // pytest: `FAILED test/x.py::test_names_it`.
  /(?:^|\s)(?:FAILED|ERROR)\s+\S+::/u,
  // TAP: `not ok <index> - names it`.
  /^not ok\b/u,
]

function isFailureHeadline(line: string): boolean {
  return FAILURE_HEADLINE_PATTERNS.some((pattern) => pattern.test(line))
}

function splitOnce(
  value: string,
  separators: readonly string[],
): [string, string] | null {
  for (const separator of separators) {
    const index = value.indexOf(separator)

    if (index > 0) {
      return [
        value.slice(0, index).trim(),
        value.slice(index + separator.length).trim(),
      ]
    }
  }

  return null
}

function unquote(value: string): string {
  return value.replaceAll('`', '').trim()
}

/**
 * Parse the known-failing declarations a run request carries.
 *
 * A declaration exists so an entry gate can report an already-broken test as
 * inherited instead of blaming the stage that happened to run next. That is
 * only safe when the declaration is precise: it names exactly one case and
 * says why. A bare file path is rejected rather than parsed loosely, because
 * the loose reading credits every failure in the file — including the
 * regression the gate exists to catch.
 */
export function parseKnownFailingTests(markdown: string): KnownFailingTest[] {
  const lines = markdown.split(/\r?\n/u)
  const declarations: KnownFailingTest[] = []

  let inSection = false

  for (const line of lines) {
    if (SECTION_HEADING.test(line)) {
      inSection = true
      continue
    }

    if (inSection && NEXT_HEADING.test(line)) {
      break
    }

    if (!inSection) {
      continue
    }

    const item = LIST_ITEM.exec(line)?.[1]

    if (!item) {
      continue
    }

    const withReason = splitOnce(item, REASON_SEPARATORS)

    if (!withReason) {
      continue
    }

    const [identity, reason] = withReason
    const split = splitOnce(unquote(identity), CASE_SEPARATORS)

    if (!split || reason.length === 0) {
      continue
    }

    const [file, testCase] = split

    if (file.length === 0 || testCase.length === 0) {
      continue
    }

    declarations.push({ file, case: testCase, reason })
  }

  return declarations
}

export interface KnownFailingCredit {
  /** Failure headlines a declaration covers. */
  credited: string[]
  /** Diagnostics no declaration covers. Any one of these fails the gate. */
  undeclared: string[]
}

/**
 * A declaration names the source file an operator reads, and a runner reports
 * the file it executed. This repository's own reporter prints the compiled
 * `dist/tests/unit/x.test.js` for the test written at `tests/unit/x.test.ts`,
 * so matching the declared path verbatim credits nothing. Dropping the
 * extension leaves the stem both spellings share.
 */
function fileStem(file: string): string {
  return file.replace(/\.[^./]+$/u, '')
}

function creditsLine(declaration: KnownFailingTest, line: string): boolean {
  return (
    line.includes(fileStem(declaration.file)) && line.includes(declaration.case)
  )
}

/**
 * Identity for a failing entry that no transcript line describes. The gate
 * prints every `undeclared` string, so it names the entry an operator reruns
 * rather than a diagnostic that was never printed.
 */
function failureIdentity(
  entry: RepositoryCheckCommandResult,
  reason: string,
): string {
  return `${entry.kind} \`${entry.command}\` ${reason}`
}

/**
 * Split a failing repository-check result into the failures the run declared
 * as known and the ones it did not.
 *
 * Within a command that produced at least one failure headline, only headlines
 * are judged: the error text and stack frames printed under a failure describe
 * that same failure, and counting them would leave a fully declared suite
 * looking undeclared. A command that produced no headline at all — a linter,
 * a type checker, a suite that died before it could report a case — has every
 * diagnostic judged, because nothing there was a test case to declare.
 *
 * Every failing entry contributes at least one string to one of the two lists.
 * The gate accepts a profile when `undeclared` is empty, so an entry that
 * contributed nothing let one credited case elsewhere in the profile launder
 * it into a reported baseline pass.
 */
export function creditKnownFailures(
  result: RepositoryCheckResult,
  declarations: readonly KnownFailingTest[],
): KnownFailingCredit {
  const credited: string[] = []
  const undeclared: string[] = []

  for (const entry of result.results) {
    if (entry.passed) {
      continue
    }

    // A declaration names one test case. A timeout names none, because the
    // runner never finished reporting, and the acceptance rule this repository
    // states already refuses to credit one. A probe failure means the
    // environment was not ready, which is the one condition a gate must never
    // launder. Neither is judged by its transcript.
    if (entry.timed_out) {
      undeclared.push(failureIdentity(entry, 'timed out'))
      continue
    }

    if (entry.kind === 'probe') {
      undeclared.push(failureIdentity(entry, 'failed'))
      continue
    }

    const diagnostics = commandFailureDiagnostics(entry, result.workspace_root)
    const headlines = diagnostics.filter(isFailureHeadline)

    if (headlines.length === 0) {
      undeclared.push(
        ...(diagnostics.length > 0
          ? diagnostics
          : [
              failureIdentity(
                entry,
                `failed with exit code ${entry.exit_code ?? 'none'} and ` +
                  'reported no diagnostic',
              ),
            ]),
      )
      continue
    }

    for (const headline of headlines) {
      if (
        declarations.some((declaration) => creditsLine(declaration, headline))
      ) {
        credited.push(headline)
        continue
      }

      undeclared.push(headline)
    }
  }

  return { credited, undeclared }
}
