import { readFileSync } from "node:fs";
import path from "node:path";

import {
  readProjectRootFromYaml,
  resolvePancreatorYamlPath,
} from "./project-root.js";

/**
 * Project-relative path to the agent operating card for a harness root.
 * - Embedded (`project_root: ".pancreator"`): `.pancreator/AGENTS.md`
 * - Self-host and greenfield: `AGENTS.md` at harness root
 */
export function resolveDeliveryOperatingCardRel(harnessRoot: string): string {
  const harness = path.resolve(harnessRoot);
  const cfgPath = resolvePancreatorYamlPath(harness);
  const projectRootRel = cfgPath
    ? readProjectRootFromYaml(readFileSync(cfgPath, "utf8"))
    : ".";

  if (projectRootRel === ".pancreator") {
    return ".pancreator/AGENTS.md";
  }

  return "AGENTS.md";
}

/** Absolute path to the agent operating card. */
export function resolveDeliveryOperatingCard(harnessRoot: string): string {
  const rel = resolveDeliveryOperatingCardRel(harnessRoot);
  return path.join(path.resolve(harnessRoot), ...rel.split("/"));
}
