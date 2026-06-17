export const SUITE_IDS = ["client", "compliance", "repo-structure", "pan-check"] as const;

export type SuiteId = (typeof SUITE_IDS)[number];

export type SuiteDefinition = {
  id: SuiteId;
  label: string;
  command: string;
};

export const SUITE_DEFINITIONS: SuiteDefinition[] = [
  {
    id: "client",
    label: "pnpm test",
    command: "pnpm --dir client test",
  },
  {
    id: "compliance",
    label: "node lib/internal/tools/compliance/run-compliance.mjs",
    command: "node lib/internal/tools/compliance/run-compliance.mjs",
  },
  {
    id: "repo-structure",
    label: "node --test tests/*.test.mjs",
    command: "node lib/internal/tools/checks/check-workspace-contracts.mjs && node --test tests/*.test.mjs",
  },
  {
    id: "pan-check",
    label: "pnpm -w exec pan check",
    command: "pnpm -w exec pan check",
  },
];

export const SHELL_METACHAR_PATTERN = /[;&|`$()<>\n\r\0]/u;

export function validateSuiteId(rawSuite: string): { error: string } | null {
  const suite = rawSuite.trim();
  if (suite.length === 0) {
    return { error: "Suite id is required" };
  }
  if (SHELL_METACHAR_PATTERN.test(suite)) {
    return { error: "Shell metacharacters are not allowed" };
  }
  if (!SUITE_IDS.includes(suite as SuiteId)) {
    return { error: `Suite "${suite}" is not allowlisted` };
  }
  return null;
}

export function suiteDefinition(suiteId: SuiteId): SuiteDefinition {
  const match = SUITE_DEFINITIONS.find((entry) => entry.id === suiteId);
  if (match === undefined) {
    throw new Error(`Unknown suite id "${suiteId}"`);
  }
  return match;
}
