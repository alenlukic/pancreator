/**
 * Structured output from a presence-only repository adoption scan.
 */
export interface AdoptionLanguageSignal {
  /** Glossary-friendly label, for example `node`, `python`. */
  id: string;
  /** Repository-relative paths that justified the signal. */
  evidence: string[];
}

export interface AdoptionWorkspaceTooling {
  pnpm: boolean;
  turbo: boolean;
  changesets: boolean;
  evidence: string[];
}

export interface AdoptionCiSignal {
  githubWorkflows: boolean;
  evidence: string[];
}

export interface AdoptionTestFrameworkSignal {
  vitest: boolean;
  jest: boolean;
  evidence: string[];
}

export interface AdoptionScanReport {
  rootPath: string;
  languages: AdoptionLanguageSignal[];
  workspaceTooling: AdoptionWorkspaceTooling;
  ci: AdoptionCiSignal;
  testFrameworks: AdoptionTestFrameworkSignal;
  scannedAtIso: string;
}
