import type { PolicyBootstrapMeta } from "./config-v1.js";

export interface BootstrapTrackingValidation {
  ok: boolean;
  violations: string[];
}

const STATUS_RE = /^phase-(-?\d+)-(in-progress|ratified)$/u;
const M1_RATIFIED_STATUS = "m1-ratified";

/** Completed phase labels when M1 bootstrap is ratified at phase 5. */
export function expectedM1RatifiedCompletedPhases(): string[] {
  return [...expectedCompletedPhases(5), "5"];
}

/** Parses bootstrap phase labels such as `"5"` or `"-1"`. */
export function parsePhaseNumber(phase: string): number | null {
  const n = Number(phase);
  if (!Number.isInteger(n)) {
    return null;
  }
  return n;
}

/** Returns every completed phase label strictly before `currentPhase`. */
export function expectedCompletedPhases(currentPhase: number): string[] {
  const out: string[] = [];
  for (let i = -1; i < currentPhase; i += 1) {
    out.push(String(i));
  }
  return out;
}

/** Computes the three bootstrap tracking fields after ratifying `ratifiedPhase`. */
export function nextBootstrapAfterRatification(ratifiedPhase: number): Pick<
  PolicyBootstrapMeta,
  "phase" | "status" | "completedPhases"
> {
  const nextPhase = ratifiedPhase + 1;
  return {
    phase: String(nextPhase),
    status: `phase-${nextPhase}-in-progress`,
    completedPhases: expectedCompletedPhases(nextPhase),
  };
}

/**
 * Validates internal consistency of live bootstrap tracking fields.
 * Fail-closed rules:
 * - `status` MUST be `phase-<N>-in-progress` where `<N>` equals `phase`, or
 *   `m1-ratified` when phase `5` and M1 human GO is recorded.
 * - `completed_phases` MUST list every phase from `-1` through `<N - 1>` for
 *   in-progress tracking, or through `"5"` when `status` is `m1-ratified`.
 * - `phase-<N>-ratified` MUST NOT persist; ratification is an atomic advance.
 */
export function validateBootstrapTracking(
  bootstrap: PolicyBootstrapMeta | undefined,
): BootstrapTrackingValidation {
  const violations: string[] = [];
  if (!bootstrap) {
    return { ok: false, violations: ["bootstrap block is missing"] };
  }

  const { phase, status, completedPhases } = bootstrap;
  if (!phase) {
    violations.push("bootstrap.phase is missing");
  }
  if (!status) {
    violations.push("bootstrap.status is missing");
  }
  if (!completedPhases?.length) {
    violations.push("bootstrap.completed_phases is missing or empty");
  }

  const currentPhase = phase ? parsePhaseNumber(phase) : null;
  if (phase && currentPhase === null) {
    violations.push(`bootstrap.phase "${phase}" is not a valid integer phase number`);
  }

  const statusMatch = status ? STATUS_RE.exec(status) : null;
  const m1Ratified = status === M1_RATIFIED_STATUS;

  if (status && !statusMatch && !m1Ratified) {
    violations.push(
      `bootstrap.status "${status}" must match phase-<N>-in-progress or ${M1_RATIFIED_STATUS}`,
    );
  }

  if (m1Ratified) {
    if (phase !== "5") {
      violations.push(
        `bootstrap.status "${M1_RATIFIED_STATUS}" requires bootstrap.phase "5" (got "${phase ?? ""}")`,
      );
    }
    const expectedM1 = expectedM1RatifiedCompletedPhases();
    if (
      completedPhases &&
      (completedPhases.length !== expectedM1.length ||
        completedPhases.some((p, i) => p !== expectedM1[i]))
    ) {
      violations.push(
        `bootstrap.completed_phases must be ${JSON.stringify(expectedM1)} when status is ${M1_RATIFIED_STATUS} (got ${JSON.stringify(completedPhases)})`,
      );
    }
  }

  if (completedPhases?.length) {
    for (let i = 0; i < completedPhases.length; i += 1) {
      const expected = String(i - 1);
      if (completedPhases[i] !== expected) {
        violations.push(
          `bootstrap.completed_phases must be contiguous from "-1"; expected index ${i} to be "${expected}", got "${completedPhases[i] ?? ""}"`,
        );
        break;
      }
    }
  }

  if (currentPhase !== null && statusMatch && !m1Ratified) {
    const statusPhase = Number(statusMatch[1]);
    const statusKind = statusMatch[2];

    if (statusKind === "ratified") {
      const next = nextBootstrapAfterRatification(statusPhase);
      violations.push(
        `bootstrap.status "${status}" is not a stable tracking state; ratify phase ${statusPhase} atomically with phase="${next.phase}", status="${next.status}", completed_phases=${JSON.stringify(next.completedPhases)}`,
      );
    } else if (statusPhase !== currentPhase) {
      violations.push(
        `bootstrap.status references phase ${statusPhase} but bootstrap.phase is "${phase}"`,
      );
    }

    const expected = expectedCompletedPhases(currentPhase);
    if (
      completedPhases &&
      (completedPhases.length !== expected.length ||
        completedPhases.some((p, i) => p !== expected[i]))
    ) {
      violations.push(
        `bootstrap.completed_phases must be ${JSON.stringify(expected)} when phase is ${currentPhase} (got ${JSON.stringify(completedPhases)})`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}
