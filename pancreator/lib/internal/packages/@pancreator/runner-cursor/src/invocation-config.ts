import { resolvePancreatorYamlPath } from "@pancreator/core";
import { readFileSync } from "node:fs";

/** Reads `runner.cursor.invocation` from repo-root `pancreator.yaml`; defaults to `manual`. */
export function readCursorInvocationMode(repoRoot: string): "manual" | "sdk" {
  const cfgPath = resolvePancreatorYamlPath(repoRoot);
  if (cfgPath === undefined) {
    return "manual";
  }
  const raw = readFileSync(cfgPath, "utf8");
  const match = /runner:\s*\n(?:\s+.+\n)*?\s+cursor:\s*\n(?:\s+.+\n)*?\s+invocation:\s*(manual|sdk)/u.exec(
    raw,
  );
  if (match?.[1] === "sdk") {
    return "sdk";
  }
  if (/runner\.cursor\.invocation:\s*sdk/u.test(raw)) {
    return "sdk";
  }
  return "manual";
}
